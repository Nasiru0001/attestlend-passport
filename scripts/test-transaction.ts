import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Contract, Wallet, parseEther } from "ethers";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(repositoryRoot, ".env") });

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

async function main(): Promise<void> {
  console.log("=== AttestLend Direct Transaction Test ===");

  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  const provider = new Wallet(privateKey);
  const deployerAddress = await provider.getAddress();
  const deployment = await import(resolve(repositoryRoot, "deployments/source-sepolia.json"));
  const loanBookAddress = deployment.contracts.SimpleLoanBook.address;

  console.log(`Deployer: ${deployerAddress}`);
  console.log(`SimpleLoanBook: ${loanBookAddress}`);

  const loanBook = new Contract(loanBookAddress, LOAN_BOOK_ABI, provider);

  console.log("\n[1] Creating a loan with the deployer as both lender and borrower...");
  const now = Math.floor(Date.now() / 1000);
  const createTx = await loanBook.createLoan(
    deployerAddress,
    deployerAddress,
    PRINCIPAL,
    AMOUNT_DUE,
    now + LOAN_DURATION_SECONDS,
  );
  const createReceipt = await createTx.wait();
  console.log(`Transaction mined in block ${createReceipt.blockNumber}`);

  const createdEvent = createReceipt.logs
    .map((log: unknown) => {
      try {
        return loanBook.interface.parseLog(log as { topics: string[]; data: string });
      } catch {
        return null;
      }
    })
    .find((parsed: { name?: string } | null) => parsed?.name === "LoanCreated");

  if (!createdEvent) throw new Error("LoanCreated event not found");
  const loanId = String(createdEvent.args.loanId);
  console.log(`Loan ID: ${loanId}`);

  console.log("\n[2] Repaying the loan in full...");
  const repayTx = await loanBook.repayLoan(loanId, REPAYMENT);
  const repayReceipt = await repayTx.wait();
  console.log(`Transaction mined in block ${repayReceipt.blockNumber}`);

  const loanRepaidEvent = repayReceipt.logs
    .map((log: unknown) => {
      try {
        return loanBook.interface.parseLog(log as { topics: string[]; data: string });
      } catch {
        return null;
      }
    })
    .find((parsed: { name?: string } | null) => parsed?.name === "LoanRepaid");

  if (!loanRepaidEvent) throw new Error("LoanRepaid event not found");

  console.log("\n[3] Test transaction created successfully!");
  console.log(`Loan ID: ${loanId}`);
  console.log(`Borrower: ${deployerAddress}`);
  console.log(`Repayment tx: ${repayReceipt.hash}`);
  console.log(`Repayment block: ${repayReceipt.blockNumber}`);

  console.log("\n[4] The worker should now detect this transaction and process it.");
  console.log("Start the worker to verify: cd worker && npm run start");
}

main().catch((error) => {
  console.error("\nTest failed:");
  console.error(error);
  process.exitCode = 1;
});
