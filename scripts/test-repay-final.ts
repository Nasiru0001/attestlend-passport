import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, Wallet, JsonRpcProvider, parseEther } from "ethers";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envContent = await readFile(resolve(repositoryRoot, ".env"), "utf-8");

const ENV = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [key, ...valueParts] = trimmed.split("=");
  ENV[key.trim()] = valueParts.join("=").trim();
}

const privateKey = ENV.DEPLOYER_PRIVATE_KEY;
const rpcUrl = ENV.SOURCE_CHAIN_RPC_URL;
const provider = new JsonRpcProvider(rpcUrl);
const deployer = new Wallet(privateKey, provider);
const deployerAddress = await deployer.getAddress();

const deployment = await import(resolve(repositoryRoot, "deployments/source-sepolia.json"));
const loanBookAddress = deployment.contracts.SimpleLoanBook.address;

console.log("=== AttestLend Create and Repay Test ===");
console.log(`Deployer: ${deployerAddress}`);
console.log(`SimpleLoanBook: ${loanBookAddress}`);

const LOAN_BOOK_ABI = [
  "function createLoan(address borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline) returns (bytes32 loanId)",
  "function repayLoan(bytes32 loanId, uint256 paymentAmount) returns (bool fullyRepaid)",
  "event LoanCreated(bytes32 indexed loanId, address indexed lender, address indexed borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline)",
  "event LoanRepaid(bytes32 indexed loanId, address indexed borrower, address indexed lender, address token, uint256 paymentAmount, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)",
];

const loanBook = new Contract(loanBookAddress, LOAN_BOOK_ABI, deployer);

console.log("\n[1] Creating a loan with the deployer as both lender and borrower...");
const now = Math.floor(Date.now() / 1000);
const createTx = await loanBook.createLoan(
  deployerAddress,
  deployerAddress,
  parseEther("1000"),
  parseEther("1050"),
  now + 30 * 24 * 60 * 60,
);
const createReceipt = await createTx.wait();
console.log(`✓ Loan created in block ${createReceipt.blockNumber}`);

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
console.log(`✓ Loan ID: ${loanId}`);

console.log("\n[2] Repaying the loan in full...");
const repayTx = await loanBook.repayLoan(loanId, parseEther("1050"));
const repayReceipt = await repayTx.wait();
console.log(`✓ Loan repaid in block ${repayReceipt.blockNumber}`);

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
console.log(`✓ Loan ID: ${loanId}`);
console.log(`✓ Borrower: ${deployerAddress}`);
console.log(`✓ Repayment tx: ${repayReceipt.hash}`);
console.log(`✓ Repayment block: ${repayReceipt.blockNumber}`);
console.log(`✓ Payment amount: 1050 tokens`);

console.log("\n[4] The worker should now detect this transaction and process it.");
console.log("Start the worker to verify: cd worker && npm run start");
console.log("Monitor the worker logs for:");
console.log("  - 'Waiting for attestation: tx=...',");
console.log("  - 'Submitted proof: tx=..., creditcoinTx=...'");
console.log("  - Check CreditPassport score updates to 510 (from 500)");
