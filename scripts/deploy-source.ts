import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

// Load the repository-level .env file even when this script is started from
// the scripts directory rather than from the repository root.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(repositoryRoot, ".env") });

const EXPECTED_SEPOLIA_CHAIN_ID = 11_155_111n;
const deploymentFile = resolve(repositoryRoot, "deployments/source-sepolia.json");

type FoundryArtifact = {
  abi: ConstructorParameters<typeof ContractFactory>[0];
  bytecode: { object: string };
};

type DeploymentRecord = {
  network: string;
  chainId: string;
  deployer: string;
  deployedAt: string;
  blockNumber: number;
  contracts: {
    TestToken: { address: string; constructorArgs: string[] };
    SimpleLoanBook: { address: string; constructorArgs: string[] };
  };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function loadArtifact(name: string): Promise<FoundryArtifact> {
  const artifactPath = resolve(repositoryRoot, `out/${name}.sol/${name}.json`);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as FoundryArtifact;
  if (!artifact.bytecode?.object || !artifact.abi) {
    throw new Error(`Invalid Foundry artifact: ${artifactPath}. Run forge build first.`);
  }
  return artifact;
}

async function main(): Promise<void> {
  const rpcUrl = required("SOURCE_CHAIN_RPC_URL");
  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  // A wrong RPC URL can otherwise deploy valid contracts to the wrong chain.
  if (network.chainId !== EXPECTED_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Expected Ethereum Sepolia (${EXPECTED_SEPOLIA_CHAIN_ID}), connected to chain ${network.chainId}`,
    );
  }

  const deployer = new Wallet(privateKey, provider);
  console.log(`Deploying source contracts from ${deployer.address} on Sepolia...`);

  // Foundry stores ABI and creation bytecode separately. ContractFactory uses
  // both to create and deploy a normal ethers.js contract instance.
  const tokenArtifact = await loadArtifact("TestToken");
  const loanBookArtifact = await loadArtifact("SimpleLoanBook");

  console.log("Deploying TestToken...");
  const token = await new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode.object, deployer).deploy();
  const tokenReceipt = await token.deploymentTransaction()?.wait();
  const tokenAddress = await token.getAddress();
  if (!tokenReceipt) throw new Error("TestToken deployment did not return a receipt");
  console.log(`TestToken deployed at ${tokenAddress} in block ${tokenReceipt.blockNumber}`);

  console.log("Deploying SimpleLoanBook...");
  const loanBook = await new ContractFactory(
    loanBookArtifact.abi,
    loanBookArtifact.bytecode.object,
    deployer,
  ).deploy();
  const loanBookReceipt = await loanBook.deploymentTransaction()?.wait();
  const loanBookAddress = await loanBook.getAddress();
  if (!loanBookReceipt) throw new Error("SimpleLoanBook deployment did not return a receipt");
  console.log(`SimpleLoanBook deployed at ${loanBookAddress} in block ${loanBookReceipt.blockNumber}`);

  // The frontend and worker consume this machine-readable record rather than
  // parsing terminal output. Constructor arguments are included for auditing.
  const record: DeploymentRecord = {
    network: "ethereum-sepolia",
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: Math.max(tokenReceipt.blockNumber, loanBookReceipt.blockNumber),
    contracts: {
      TestToken: { address: tokenAddress, constructorArgs: [] },
      SimpleLoanBook: { address: loanBookAddress, constructorArgs: [] },
    },
  };

  await mkdir(dirname(deploymentFile), { recursive: true });
  await writeFile(deploymentFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`Deployment record written to ${deploymentFile}`);
}

main().catch((error) => {
  console.error("Source deployment failed:", error);
  process.exitCode = 1;
});
