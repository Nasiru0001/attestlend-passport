import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ContractFactory, JsonRpcProvider, Wallet, getAddress } from "ethers";

// Load the same repository-level environment file used by the worker and the
// source deployment script.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(repositoryRoot, ".env") });

const EXPECTED_CREDITCOIN_CHAIN_ID = 102_031n;
const DEFAULT_VERIFIER_ADDRESS = "0x0000000000000000000000000000000000000FD2";
const sourceDeploymentFile = resolve(repositoryRoot, "deployments/source-sepolia.json");
const deploymentFile = resolve(repositoryRoot, "deployments/creditcoin-cc3-testnet.json");

type FoundryArtifact = {
  abi: ConstructorParameters<typeof ContractFactory>[0];
  bytecode: { object: string };
};

type SourceDeployment = {
  contracts: { SimpleLoanBook: { address: string } };
};

type DeploymentRecord = {
  network: string;
  chainId: string;
  deployer: string;
  deployedAt: string;
  blockNumber: number;
  contracts: {
    CreditPassport: {
      address: string;
      constructorArgs: [string, string];
      verifier: string;
      sourceLoanBook: string;
    };
  };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function loadArtifact(): Promise<FoundryArtifact> {
  const artifactPath = resolve(repositoryRoot, "out/CreditPassport.sol/CreditPassport.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as FoundryArtifact;
  if (!artifact.bytecode?.object || !artifact.abi) {
    throw new Error(`Invalid Foundry artifact: ${artifactPath}. Run forge build first.`);
  }
  return artifact;
}

async function loadSourceLoanBookAddress(): Promise<string> {
  // Prefer an explicit environment value for deployments managed outside this
  // repository, otherwise use the address produced by deploy-source.ts.
  if (process.env.SOURCE_LOAN_BOOK_ADDRESS) return getAddress(process.env.SOURCE_LOAN_BOOK_ADDRESS);

  const sourceDeployment = JSON.parse(await readFile(sourceDeploymentFile, "utf8")) as SourceDeployment;
  return getAddress(sourceDeployment.contracts.SimpleLoanBook.address);
}

async function main(): Promise<void> {
  const rpcUrl = required("CREDITCOIN_RPC_URL");
  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  const verifierAddress = getAddress(process.env.ATTESTCOIN_VERIFIER_ADDRESS ?? DEFAULT_VERIFIER_ADDRESS);
  const sourceLoanBookAddress = await loadSourceLoanBookAddress();
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  // This guard prevents accidentally deploying a Creditcoin-only contract to
  // Sepolia or another EVM network with an incompatible verifier precompile.
  if (network.chainId !== EXPECTED_CREDITCOIN_CHAIN_ID) {
    throw new Error(
      `Expected Creditcoin CC3 Testnet (${EXPECTED_CREDITCOIN_CHAIN_ID}), connected to chain ${network.chainId}`,
    );
  }

  const deployer = new Wallet(privateKey, provider);
  console.log(`Deploying CreditPassport from ${deployer.address} on Creditcoin CC3 Testnet...`);
  console.log(`Verifier: ${verifierAddress}`);
  console.log(`Source loan book: ${sourceLoanBookAddress}`);

  const artifact = await loadArtifact();
  // CreditPassport(verifier, loanBook) binds this Creditcoin deployment to the
  // native proof verifier and the exact SimpleLoanBook source address.
  const passport = await new ContractFactory(artifact.abi, artifact.bytecode.object, deployer).deploy(
    verifierAddress,
    sourceLoanBookAddress,
  );
  const receipt = await passport.deploymentTransaction()?.wait();
  const passportAddress = await passport.getAddress();
  if (!receipt) throw new Error("CreditPassport deployment did not return a receipt");
  console.log(`CreditPassport deployed at ${passportAddress} in block ${receipt.blockNumber}`);

  // Store both constructor arguments so the worker/frontend can verify that
  // their configured addresses correspond to this exact deployment.
  const record: DeploymentRecord = {
    network: "creditcoin-cc3-testnet",
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: receipt.blockNumber,
    contracts: {
      CreditPassport: {
        address: passportAddress,
        constructorArgs: [verifierAddress, sourceLoanBookAddress],
        verifier: verifierAddress,
        sourceLoanBook: sourceLoanBookAddress,
      },
    },
  };

  await mkdir(dirname(deploymentFile), { recursive: true });
  await writeFile(deploymentFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`Deployment record written to ${deploymentFile}`);
}

main().catch((error) => {
  console.error("Creditcoin deployment failed:", error);
  process.exitCode = 1;
});
