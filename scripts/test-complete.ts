import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, Wallet, JsonRpcProvider, MaxUint256, parseEther } from "ethers";

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
const deployer = new Wallet(privateKey, new JsonRpcProvider(rpcUrl));
const deployerAddress = await deployer.getAddress();

const deployment = await import(resolve(repositoryRoot, "deployments/source-sepolia.json"));
const tokenAddress = deployment.contracts.TestToken.address;
const loanBookAddress = deployment.contracts.SimpleLoanBook.address;
const creditcoinPassportAddress = deployment.contracts.CreditPassport?.address;

// Note: CreditPassport is deployed on Creditcoin, not source Sepolia
if (!creditcoinPassportAddress) {
  console.log("⚠️  CreditPassport is deployed on Creditcoin network, not source Sepolia");
  console.log("⚠️  This test only validates the source-side loan creation and repayment");
}

console.log("=== AttestLend Complete Test ===");
console.log(`Deployer: ${deployerAddress}`);
console.log(`TestToken: ${tokenAddress}`);
console.log(`SimpleLoanBook: ${loanBookAddress}`);
console.log(`CreditPassport: ${creditcoinPassportAddress}`);

const TOKEN_ABI = [
  "function faucet(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

const LOAN_BOOK_ABI = [
  "function createLoan(address borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline) returns (bytes32 loanId)",
  "function fundLoan(bytes32 loanId) returns (bool)",
  "function repayLoan(bytes32 loanId, uint256 paymentAmount) returns (bool)",
  "event LoanRepaid(bytes32 indexed loanId, address indexed borrower, address indexed lender, address token, uint256 paymentAmount, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)",
];

const PASSPORT_ABI = [
  "function getScore(address borrower) view returns (uint256)",
  "function scores(address) view returns (uint256)",
];

const now = Math.floor(Date.now() / 1000);
const loanDuration = 30 * 24 * 60 * 60; // 30 days

console.log("\n=== Step 1: Mint tokens to deployer ===");
const token = new Contract(tokenAddress, TOKEN_ABI, deployer);
const initialBalance = await token.balanceOf(deployerAddress);
console.log(`Initial token balance: ${initialBalance}`);

console.log("\n=== Step 2: Approve SimpleLoanBook to spend tokens ===");
const approveTx = await token.approve(loanBookAddress, MaxUint256);
await approveTx.wait();
console.log(`Approval confirmed`);

console.log("\n=== Step 3: Create a loan ===");
const loanBook = new Contract(loanBookAddress, LOAN_BOOK_ABI, deployer);
const createTx = await loanBook.createLoan(
  deployerAddress,
  tokenAddress,
  parseEther("1000"),
  parseEther("1050"),
  now + loanDuration,
);
const createReceipt = await createTx.wait();
console.log(`✓ Loan created in block ${createReceipt.blockNumber}`);

// Debug: Print all logs
console.log("Transaction logs:");
createReceipt.logs.forEach((log: any) => {
  try {
    const parsed = loanBook.interface.parseLog({
      topics: log.topics,
      data: log.data,
    });
    console.log(`  Event: ${parsed.name}`);
    console.log(`  Args:`, parsed.args);
  } catch (e) {
    console.log(`  Log (non-event):`, log);
  }
});

const loanId = createReceipt.logs
  .map((log: unknown) => {
    try {
      return loanBook.interface.parseLog(log as { topics: string[]; data: string });
    } catch {
      return null;
    }
  })
  .find((parsed: { name?: string } | null) => parsed?.name === "LoanCreated")
  ?.args.loanId;

if (!loanId) throw new Error("Failed to extract loan ID");
console.log(`✓ Loan ID: ${loanId}`);

console.log("\n=== Step 4: Fund the loan ===");
const fundTx = await loanBook.fundLoan(loanId);
await fundTx.wait();
console.log(`✓ Loan funded`);

console.log("\n=== Step 5: Approve repayment ===");
const approveRepayTx = await token.approve(loanBookAddress, parseEther("1050"));
await approveRepayTx.wait();
console.log(`✓ Repayment approved`);

console.log("\n=== Step 6: Repay the loan ===");
const repayTx = await loanBook.repayLoan(loanId, parseEther("1050"));
const repayReceipt = await repayTx.wait();
console.log(`✓ Loan repaid in block ${repayReceipt.blockNumber}`);

console.log("\n=== Step 7: Get CreditPassport score BEFORE worker processes ===");
const passport = new Contract(creditcoinPassportAddress, PASSPORT_ABI, deployer);
const beforeScore = await passport.getScore(deployerAddress);
console.log(`Score BEFORE worker: ${beforeScore} (should be 500)`);

console.log("\n=== Test Summary ===");
console.log(`✓ Created loan in block ${createReceipt.blockNumber}`);
console.log(`✓ Repaid loan in block ${repayReceipt.blockNumber}`);
console.log(`✓ Score before worker: ${beforeScore}`);
console.log("\n=== Next Steps ===");
console.log("1. Update worker checkpoint to block " + repayReceipt.blockNumber);
console.log("2. Start worker: cd worker && npm run start");
console.log("3. Monitor for 'Submitted proof: tx=..., creditcoinTx=...'");
console.log("4. Call getScore() again - should now be 510");
console.log(`\nRecommended checkpoint: ${repayReceipt.blockNumber}`);
