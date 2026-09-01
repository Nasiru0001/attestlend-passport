import "dotenv/config";

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet, AbiCoder, keccak256, id } from "ethers";
import { blockProver, proofProvider } from "@gluwa/usc-sdk";

/**
 * The event ABI is deliberately kept local to the worker. The worker only
 * needs the event definition in order to find the source transactions; the
 * proof itself is generated from the transaction hash by the Attestcoin SDK.
 */
const LOAN_BOOK_ABI = [
  "event LoanRepaid(bytes32 indexed loanId, address indexed borrower, address indexed lender, address token, uint256 paymentAmount, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)",
];

/**
 * This is the ABI of AttestcoinConsumer.execute from the Creditcoin contract.
 * The tuple shapes must match VerifierInterface.sol exactly.
 */
const PASSPORT_ABI = [
  "function execute(uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, tuple(bytes32 root, tuple(bytes32 hash, bool isLeft)[] siblings) merkleProof, tuple(bytes32 lowerEndpointDigest, bytes32[] roots) continuityProof) returns (bytes32 queryId)",
];

const SIMPLE_LOAN_BOOK_ABI = [
  "event LoanRepaid(bytes32 indexed loanId, address indexed borrower, address indexed lender, address token, uint256 paymentAmount, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)",
];

// `src/index.ts` lives one directory below `worker/`. Keeping this path based
// on the module location means the checkpoint is always worker/state.json,
// even when the process is started from the repository root or another cwd.
const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const startBlock = 11557600;

type WorkerState = {
  /** The last complete source block processed by this worker. */
  lastScannedBlock: number;
};

type Config = {
  sourceRpcUrl: string;
  creditcoinRpcUrl: string;
  proofBuilderUrl: string;
  privateKey: string;
  sourceChainKey: number;
  loanBookAddress: string;
  passportAddress: string;
  confirmations: number;
  scanIntervalMs: number;
  /** Maximum inclusive log-query window. Never allow this above five blocks. */
  maxBlockRange: number;
  stateFile: string;
};

/** Read a required environment variable and fail early with a useful error. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Parse an integer environment variable, while rejecting accidental junk. */
function integer(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined) throw new Error(`Missing required environment variable: ${name}`);

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, received: ${raw}`);
  }
  return value;
}

/** Build all runtime configuration once, before any network calls are made. */
function loadConfig(): Config {
  return {
    sourceRpcUrl: required("SOURCE_CHAIN_RPC_URL"),
    creditcoinRpcUrl: required("CREDITCOIN_RPC_URL"),
    proofBuilderUrl: required("PROOF_BUILDER_URL"),
    privateKey: required("DEPLOYER_PRIVATE_KEY"),
    sourceChainKey: integer("SOURCE_CHAIN_KEY"),
    loanBookAddress: required("SOURCE_LOAN_BOOK_ADDRESS"),
    passportAddress: required("CREDIT_PASSPORT_ADDRESS"),
    confirmations: integer("SOURCE_CONFIRMATIONS", 12),
    scanIntervalMs: integer("SCAN_INTERVAL_MS", 15_000),
    // The free Sepolia RPC allows only a ten-block eth_getLogs range. Five is
    // used as a safety margin, and the cap prevents a bad env value breaking
    // the provider limit.
    maxBlockRange: Math.max(1, Math.min(integer("MAX_BLOCK_RANGE", 5), 5)),
    // Always keep the default checkpoint directly in worker/. An explicit
    // STATE_FILE may still be supplied for testing or a managed deployment.
    stateFile: process.env.STATE_FILE ? resolve(process.env.STATE_FILE) : resolve(workerDirectory, "state.json"),
  };
}

/**
 * Persist a checkpoint atomically. Writing a temporary file and renaming it
 * prevents a process interruption from leaving half-written JSON behind.
 */
async function saveState(config: Config, state: WorkerState): Promise<void> {
  await mkdir(dirname(config.stateFile), { recursive: true });
  const temporaryFile = `${config.stateFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, config.stateFile);
}

/** Sleep between polling attempts when no new finalized blocks are available. */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

/**
 * Process one source transaction from discovery through Creditcoin submission.
 *
 * A transaction is the unit of proof in Attestcoin, not an individual log.
 * Therefore callers deduplicate transaction hashes before invoking this
 * function. This also avoids submitting the same proof twice if a transaction
 * happens to emit more than one LoanRepaid event.
 */
async function processTransaction(
  transactionHash: string,
  blockNumber: number,
  proofBuilder: proofProvider.service.ProofBuilder,
  passport: Contract,
  config: Config,
  sourceProvider: JsonRpcProvider,
): Promise<void> {
  console.log(`Waiting for attestation: tx=${transactionHash}, block=${blockNumber}`);

  // The proof builder waits until Creditcoin has attested the source block.
  await proofBuilder.waitUntilHeightAttested(config.sourceChainKey, blockNumber);

  // The proof contains the raw transaction bytes plus both Merkle proofs.
  // Never decode, re-encode, or otherwise modify txBytes: Creditcoin verifies
  // these exact bytes against the Merkle root.
  const result = await proofBuilder.getProof(transactionHash);
  if (!result.success || !result.data) {
    throw new Error(`Proof generation failed for ${transactionHash}: ${result.error ?? "unknown error"}`);
  }

  const { chainKey, headerNumber, txBytes, merkleProof, continuityProof } = result.data;

  // Decode the transaction to find the LoanRepaid event that will be processed by CreditPassport.
  // This is separate from the precompile verification, which operates on the raw txBytes.
  const decodedTx = await sourceProvider.getTransaction(transactionHash);
  if (!decodedTx) {
    throw new Error(`Failed to decode transaction ${transactionHash}`);
  }

  const simpleLoanBook = new Contract(config.loanBookAddress, SIMPLE_LOAN_BOOK_ABI, sourceProvider);
  const logs = await sourceProvider.getLogs({
    fromBlock: decodedTx.blockNumber,
    toBlock: decodedTx.blockNumber,
    address: config.loanBookAddress,
    topics: [[], [], [], id("LoanRepaid(bytes32,address,address,address,uint256,uint256,uint256,bool)")],
  });

  if (logs.length === 0) {
    throw new Error(`No LoanRepaid event found in transaction ${transactionHash}`);
  }

  // Parse the event data. CreditPassport expects abi.encode(sourceContract, topics, data)
  // where topics and data are the EVM receipt log fields.
  const event = simpleLoanBook.interface.parseLog(logs[0]);
  if (!event || event.name !== "LoanRepaid") {
    throw new Error(`Transaction ${transactionHash} did not contain LoanRepaid event`);
  }

  const sourceContract = config.loanBookAddress;
  const topics = [event.topics[0], event.topics[1], event.topics[2]];
  const data = event.data;

  // Encode in the format CreditPassport expects: abi.encode(sourceContract, topics, data)
  const abiCoder = new AbiCoder();
  const encodedTransaction = abiCoder.encode(
    ["address", "bytes32[]", "bytes"],
    [sourceContract, topics, data]
  );

  // execute() first verifies the proof in the native verifier precompile and
  // then calls CreditPassport._processVerifiedTransaction. The passport's
  // inherited replay protection makes the source query id single-use.
  const submission = await passport.execute(chainKey, headerNumber, encodedTransaction, merkleProof, continuityProof);
  const receipt = await submission.wait();
  console.log(`Submitted proof: tx=${transactionHash}, creditcoinTx=${receipt?.hash ?? submission.hash}`);
}

/**
 * Scan one bounded block window. The checkpoint is deliberately written only
 * after every matching transaction in the window has been submitted.
 */
async function scanWindow(
  sourceContract: Contract,
  proofBuilder: proofProvider.service.ProofBuilder,
  passport: Contract,
  config: Config,
  state: WorkerState,
  latestFinalizedBlock: number,
  sourceProvider: JsonRpcProvider,
): Promise<void> {
  const fromBlock = state.lastScannedBlock + 1;
  if (fromBlock > latestFinalizedBlock) return;

  // This is the only eth_getLogs/queryFilter call. Its inclusive range is
  // capped at five blocks, satisfying strict free-tier RPC providers.
  const toBlock = Math.min(fromBlock + config.maxBlockRange - 1, latestFinalizedBlock);
  console.log(`Scanning LoanRepaid events from block ${fromBlock} to ${toBlock}`);

  const events = await sourceContract.queryFilter("LoanRepaid", fromBlock, toBlock);
  const transactionBlocks = new Map<string, number>();

  for (const event of events) {
    // Every ethers v6 log returned by queryFilter includes its source
    // transaction hash and block number, which are the inputs needed by the
    // Attestcoin proof builder.
    const transactionHash = event.transactionHash;
    const eventBlock = event.blockNumber;
    if (!transactionHash || eventBlock === undefined) {
      throw new Error("LoanRepaid result did not include transaction hash and block number");
    }
    transactionBlocks.set(transactionHash, eventBlock);
  }

  // Sequential processing makes the order and failure behavior easy to audit
  // and avoids overloading the proof builder or Creditcoin RPC endpoint.
  for (const [transactionHash, blockNumber] of transactionBlocks) {
    await processTransaction(transactionHash, blockNumber, proofBuilder, passport, config, sourceProvider);
  }

  state.lastScannedBlock = toBlock;
  await saveState(config, state);
  console.log(`Checkpoint saved: lastScannedBlock=${state.lastScannedBlock}`);
}

/** Start the continuous polling loop. */
async function main(): Promise<void> {
  const config = loadConfig();

  // One provider reads Sepolia logs; the other signs and submits Creditcoin
  // transactions using the same private key supplied by DEPLOYER_PRIVATE_KEY.
  const sourceProvider = new JsonRpcProvider(config.sourceRpcUrl);
  const creditcoinProvider = new JsonRpcProvider(config.creditcoinRpcUrl);
  // Always begin from the fixed demo block. The worker intentionally does not
  // read state.json or any other file to determine its startup position.
  const state: WorkerState = { lastScannedBlock: startBlock - 1 };
  const signer = new Wallet(config.privateKey, creditcoinProvider);
  const sourceContract = new Contract(config.loanBookAddress, LOAN_BOOK_ABI, sourceProvider);
  const passport = new Contract(config.passportAddress, PASSPORT_ABI, signer);

  // ProofBuilder talks to the hosted Attestcoin service. Its internal polling
  // waits for source blocks to become attested before generating a proof.
  const proofBuilder = new proofProvider.service.ProofBuilder(
    config.sourceChainKey,
    config.proofBuilderUrl,
    5_000,
  );

  console.log(`Relayer started. Source loan book: ${config.loanBookAddress}`);
  console.log(`CreditPassport: ${config.passportAddress}`);

  while (true) {
    try {
      // Leave a confirmation margin so a short source-chain reorganization does
      // not cause us to checkpoint an event from a non-final block.
      const sourceHead = await sourceProvider.getBlockNumber();
      const latestFinalizedBlock = Math.max(0, sourceHead - config.confirmations);
      await scanWindow(sourceContract, proofBuilder, passport, config, state, latestFinalizedBlock, sourceProvider);
    } catch (error) {
      // A failed proof or submission leaves the checkpoint unchanged. The next
      // poll retries the same block window instead of silently losing credit.
      console.error("Relayer iteration failed:", error);
    }

    await sleep(config.scanIntervalMs);
  }
}

main().catch((error) => {
  console.error("Relayer failed to start:", error);
  process.exitCode = 1;
});
