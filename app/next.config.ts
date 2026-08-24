import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type SourceDeployment = {
  contracts: { TestToken: { address: string }; SimpleLoanBook: { address: string } };
};

type CreditcoinDeployment = {
  contracts: { CreditPassport: { address: string } };
};

/** Read generated deployment records at build time for browser-safe addresses. */
function deploymentAddresses() {
  try {
    const root = resolve(process.cwd(), "..");
    const source = JSON.parse(
      readFileSync(resolve(root, "deployments/source-sepolia.json"), "utf8"),
    ) as SourceDeployment;
    const creditcoin = JSON.parse(
      readFileSync(resolve(root, "deployments/creditcoin-cc3-testnet.json"), "utf8"),
    ) as CreditcoinDeployment;

    return {
      NEXT_PUBLIC_TEST_TOKEN_ADDRESS: source.contracts.TestToken.address,
      NEXT_PUBLIC_LOAN_BOOK_ADDRESS: source.contracts.SimpleLoanBook.address,
      NEXT_PUBLIC_CREDIT_PASSPORT_ADDRESS: creditcoin.contracts.CreditPassport.address,
    };
  } catch {
    // CI or a fresh checkout may not have gitignored deployment records yet.
    // Public environment variables provide the deployment-independent fallback.
    return {};
  }
}

const nextConfig: NextConfig = {
  env: deploymentAddresses(),
};

export default nextConfig;
