import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Contract, JsonRpcProvider, MaxUint256, Wallet, parseEther } from "ethers";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(repositoryRoot, ".env") });

const EXPECTED_SEPOLIA_CHAIN_ID = 11_155_111n;
const PRINCIPAL = parseEther("1000");
const AMOUNT_DUE = parseEther("1050");
const REPAYMENT = parseEther("1050");
const LOAN_DURATION_SECONDS = 30 * 24 * 60 * 60;

const LOAN_BOOK_ABI = [
  "function createLoan(address borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline) returns (bytes32 loanId)",
  "function repayLoan(bytes32 loanId, uint256 paymentAmount) returns (bool fullyRepaid)",
  "event LoanCreated(bytes32 indexed loanId, address indexed lender, address indexed borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline)",
  "event LoanRepaid(bytes32 indexed loanId, address indexed borrower, address indexed lender, address token, uint256 paymentAmount, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)",
];

async function required(name: string): Promise<string> {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function loadDeployments(): Promise<any> {
  const path = resolve(repositoryRoot, "deployments/source-sepolia.json");
  return JSON.parse(await readFile(path, "utf8")) as any;
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
  console.log("=== AttestLend Simple Repayment Flow ===");
  console.log("Loading environment and deployment addresses...");

  const provider = new JsonRpcProvider(required("SOURCE_CHAIN_RPC_URL"));
  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_SEPOLIA_CHAIN_ID) {
    throw new Error(`Expected Sepolia chain ${EXPECTED_SEPOLIA_CHAIN_ID}, connected to ${network.chainId}`);
  }

  const deployer = new Wallet(required("DEPLOYER_PRIVATE_KEY"), provider);
  const deployerAddress = await deployer.getAddress();
  const deployment = await loadDeployments();
  const loanBookAddress = deployment.contracts.SimpleLoanBook.address;

  console.log(`Connected to Ethereum Sepolia (${network.chainId})`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`SimpleLoanBook: ${loanBookAddress}`);

  const loanBook = new Contract(loanBookAddress, LOAN_BOOK_ABI, deployer);

  console.log("\n[1] Creating a loan with the deployer as both lender and borrower...");
  console.log(`Borrower: ${deployerAddress}`);
  console.log(`Principal: ${PRINCIPAL} base units (1000 tokens)`);
  console.log(`Amount due: ${AMOUNT_DUE} base units (1050 tokens)`);
  const now = Math.floor(Date.now() / 1000);
  const createTransaction = await loanBook.createLoan(
    deployerAddress,
    deployerAddress, // Using same address as lender and borrower for simplicity
    PRINCIPAL,
    AMOUNT_DUE,
    now + LOAN_DURATION_SECONDS,
  );
  const createReceipt = await createTransaction.wait();
  console.log(`SimpleLoanBook.createLoan mined in block ${createReceipt.blockNumber}`);

  console.log("\n[2] Parsing LoanCreated from the receipt...");
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

  console.log("\n[3] Repaying the loan in full...");
  const repayTransaction = await loanBook.repayLoan(loanId, REPAYMENT);
  const repayReceipt = await repayTransaction.wait();
  console.log(`SimpleLoanBook.repayLoan mined in block ${repayReceipt.blockNumber}`);

  console.log("\n[4] Parsing LoanRepaid from the receipt...");
  const loanRepaidEvent = repayReceipt.logs
    .map((log: unknown) => {
      try {
        return loanBook.interface.parseLog(log as { topics: string[]; data: string });
      } catch {
        return null;
      }
    })
    .find((parsed: { name?: string } | null) => parsed?.name === "LoanRepaid");
  if (!loanRepaidEvent) throw new Error("LoanRepaid event was not found in the repayLoan receipt");

  console.log("\n[5] Flow completed successfully!");
  console.log(`Loan ID: ${loanId}`);
  console.log(`Borrower: ${deployerAddress}`);
  console.log(`Repayment tx: ${repayReceipt.hash}`);
  console.log(`Repayment tx block: ${repayReceipt.blockNumber}`);

  console.log("\n[6] Running the worker to verify the attestation...");
  console.log("You can now start the worker with: cd worker && npm run start");
}

main().catch((error) => {
  console.error("\nFlow failed:");
  console.error(error);
  process.exitCode = 1;
});
