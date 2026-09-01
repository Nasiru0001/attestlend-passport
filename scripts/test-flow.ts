import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Contract, JsonRpcProvider, MaxUint256, Wallet, parseEther } from "ethers";

// Resolve paths from this file so the script works regardless of the directory
// from which `npm --prefix scripts run test:flow` is invoked.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(repositoryRoot, ".env") });

const EXPECTED_SEPOLIA_CHAIN_ID = 11_155_111n;
const MINT_AMOUNT = parseEther("10000");
const PRINCIPAL = parseEther("1000");
const AMOUNT_DUE = parseEther("1050");
const REPAYMENT = parseEther("1050");
const LOAN_DURATION_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_ABI = [
  "function faucet(address to, uint256 amount) returns (bool success)",
  "function approve(address spender, uint256 amount) returns (bool success)",
  "function allowance(address owner, address spender) view returns (uint256 amount)",
  "function balanceOf(address account) view returns (uint256 balance)",
];

const LOAN_BOOK_ABI = [
  "function createLoan(address borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline) returns (bytes32 loanId)",
  "function fundLoan(bytes32 loanId)",
  "function repayLoan(bytes32 loanId, uint256 paymentAmount) returns (bool fullyRepaid)",
  "event LoanCreated(bytes32 indexed loanId, address indexed lender, address indexed borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline)",
  "event LoanRepaid(bytes32 indexed loanId, address indexed borrower, address indexed lender, address token, uint256 paymentAmount, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)",
];

type SourceDeployment = {
  contracts: {
    TestToken: { address: string };
    SimpleLoanBook: { address: string };
  };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function loadDeployments(): Promise<SourceDeployment> {
  const path = resolve(repositoryRoot, "deployments/source-sepolia.json");
  return JSON.parse(await readFile(path, "utf8")) as SourceDeployment;
}

async function waitForTransaction(label: string, transaction: { hash: string; wait: () => Promise<any> }) {
  console.log(`${label} submitted: ${transaction.hash}`);
  console.log(`${label}: waiting for confirmation...`);
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${label} did not return a transaction receipt`);
  console.log(`${label} mined in block ${receipt.blockNumber}`);
  return receipt;
}

async function main(): Promise<void> {
  console.log("=== AttestLend direct Sepolia flow ===");
  console.log("Loading environment and deployment addresses...");

  const provider = new JsonRpcProvider(required("SOURCE_CHAIN_RPC_URL"));
  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_SEPOLIA_CHAIN_ID) {
    throw new Error(`Expected Sepolia chain ${EXPECTED_SEPOLIA_CHAIN_ID}, connected to ${network.chainId}`);
  }

  const deployer = new Wallet(required("DEPLOYER_PRIVATE_KEY"), provider);
  const deployerAddress = await deployer.getAddress();
  const deployment = await loadDeployments();
  const tokenAddress = deployment.contracts.TestToken.address;
  const loanBookAddress = deployment.contracts.SimpleLoanBook.address;

  console.log(`Connected to Ethereum Sepolia (${network.chainId})`);
  console.log(`Deployer acting as lender and borrower: ${deployerAddress}`);
  console.log(`TestToken: ${tokenAddress}`);
  console.log(`SimpleLoanBook: ${loanBookAddress}`);

  const testToken = new Contract(tokenAddress, TOKEN_ABI, deployer);
  const loanBook = new Contract(loanBookAddress, LOAN_BOOK_ABI, deployer);

  console.log("\n[1] Contracts loaded successfully.");

  console.log(`\n[2] Minting ${MINT_AMOUNT / parseEther("1")} TestTokens to the deployer...`);
  await waitForTransaction("TestToken.faucet", await testToken.faucet(deployerAddress, MINT_AMOUNT));
  console.log(`TestToken balance: ${await testToken.balanceOf(deployerAddress)} base units`);

  console.log("\n[3] Approving SimpleLoanBook to spend MaxUint256 TestTokens...");
  console.log(`Approval spender: ${loanBookAddress}`);
  await waitForTransaction("TestToken.approve(MaxUint256)", await testToken.approve(loanBookAddress, MaxUint256));

  console.log("\n[4] Confirming MaxUint256 allowance...");
  const loanAllowance = await testToken.allowance(deployerAddress, loanBookAddress);
  console.log(`Current allowance: ${loanAllowance} base units`);
  if (loanAllowance !== MaxUint256) throw new Error("MaxUint256 allowance was not stored as expected");

  const repaymentDeadline = Math.floor(Date.now() / 1000) + LOAN_DURATION_SECONDS;
  console.log("\n[5] Creating a loan with the deployer as both lender and borrower...");
  console.log(`Borrower: ${deployerAddress}`);
  console.log(`Principal: ${PRINCIPAL} base units (1000 tokens)`);
  console.log(`Amount due: ${AMOUNT_DUE} base units (1050 tokens)`);
  console.log(`Repayment deadline: ${repaymentDeadline}`);
  const createTransaction = await loanBook.createLoan(
    deployerAddress,
    tokenAddress,
    PRINCIPAL,
    AMOUNT_DUE,
    repaymentDeadline,
  );
  const createReceipt = await waitForTransaction("SimpleLoanBook.createLoan", createTransaction);

  console.log("\n[6] Parsing LoanCreated from the receipt...");
  const createdEvent = createReceipt.logs
    .map((log: unknown) => {
      try {
        return loanBook.interface.parseLog(log as { topics: string[]; data: string });
      } catch {
        return null;
      }
    })
    .find((parsed: { name?: string } | null) => parsed?.name === "LoanCreated");
  if (!createdEvent) throw new Error("LoanCreated event was not found in the createLoan receipt");

  const loanId = String(createdEvent.args.loanId);
  console.log(`LoanCreated.loanId: ${loanId}`);
  console.log(`Loan ID decimal form: ${BigInt(loanId).toString(10)}`);

  // SimpleLoanBook requires a created loan to be funded before it can be
  // repaid. Because the deployer is also the lender in this direct flow, the
  // same signer can fund it immediately.
  console.log("\n[6b] Funding the newly created loan...");
  const fundingAllowance = await testToken.allowance(deployerAddress, loanBookAddress);
  console.log("Allowance immediately before fundLoan:", {
    owner: deployerAddress,
    spender: loanBookAddress,
    allowance: fundingAllowance.toString(),
    required: PRINCIPAL.toString(),
  });
  if (fundingAllowance < PRINCIPAL) {
    console.log("Allowance is insufficient before fundLoan; sending a fresh MaxUint256 approval...");
    await waitForTransaction("TestToken.approve(MaxUint256 before fundLoan)", await testToken.approve(loanBookAddress, MaxUint256));
    const confirmedFundingAllowance = await testToken.allowance(deployerAddress, loanBookAddress);
    console.log(`Allowance after re-approval: ${confirmedFundingAllowance}`);
    if (confirmedFundingAllowance < PRINCIPAL) {
      throw new Error("Allowance is still insufficient after the fundLoan approval receipt was mined");
    }
  }
  await waitForTransaction("SimpleLoanBook.fundLoan", await loanBook.fundLoan(loanId));

  console.log("\n[7] Approving the 1050-token repayment amount...");
  await waitForTransaction("TestToken.approve(repayment)", await testToken.approve(loanBookAddress, REPAYMENT));

  console.log("\n[8] Confirming repayment allowance...");
  const repaymentAllowance = await testToken.allowance(deployerAddress, loanBookAddress);
  console.log(`Current repayment allowance: ${repaymentAllowance} base units`);
  if (repaymentAllowance < REPAYMENT) throw new Error("Repayment allowance is lower than 1050 tokens");

  console.log("\n[9] Repaying the loan in full...");
  const repayTransaction = await loanBook.repayLoan(loanId, REPAYMENT);
  await waitForTransaction("SimpleLoanBook.repayLoan", repayTransaction);

  console.log("\n[10] Flow completed successfully!");
}

main().catch((error) => {
  console.error("\nFlow failed:");
  console.error(error);
  process.exitCode = 1;
});
