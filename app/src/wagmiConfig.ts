import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { sepolia } from "wagmi/chains";

/** Creditcoin CC3 Testnet is EVM-compatible but is not in viem's presets. */
export const creditcoinTestnet = defineChain({
  id: 102031,
  name: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Test Creditcoin", symbol: "tCTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] } },
  blockExplorers: {
    default: { name: "Creditcoin Blockscout", url: "https://creditcoin-testnet.blockscout.com" },
  },
  testnet: true,
});

/** RainbowKit owns wallet discovery and connection state for the app. */
export const wagmiConfig = getDefaultConfig({
  appName: "AttestLend Passport",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "attestlend-hackathon-demo",
  chains: [sepolia, creditcoinTestnet],
  ssr: false,
});
