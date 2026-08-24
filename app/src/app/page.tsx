"use client";

import { useEffect, useState } from "react";
import {
  BrowserProvider,
  Contract,
  Eip1193Provider,
  Interface,
  formatUnits,
  isAddress,
  parseUnits,
} from "ethers";

const SEPOLIA = {
  chainId: "0xaa36a7",
  chainName: "Ethereum Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

const CREDITCOIN = {
  chainId: "0x18e8f",
  chainName: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Test Creditcoin", symbol: "tCTC", decimals: 18 },
  rpcUrls: ["https://rpc.cc3-testnet.creditcoin.network"],
  blockExplorerUrls: ["https://creditcoin-testnet.blockscout.com"],
};

const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TEST_TOKEN_ADDRESS ?? "";
const LOAN_BOOK_ADDRESS = process.env.NEXT_PUBLIC_LOAN_BOOK_ADDRESS ?? "";
const PASSPORT_ADDRESS = process.env.NEXT_PUBLIC_CREDIT_PASSPORT_ADDRESS ?? "";

const TOKEN_ABI = [
  "function faucet(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

const LOAN_BOOK_ABI = [
  "function createLoan(address borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline) returns (bytes32 loanId)",
  "function fundLoan(bytes32 loanId)",
  "function repayLoan(bytes32 loanId, uint256 paymentAmount) returns (bool fullyRepaid)",
  "event LoanCreated(bytes32 indexed loanId, address indexed lender, address indexed borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline)",
];

const PASSPORT_ABI = [
  "function getScore(address borrower) view returns (uint256)",
  "function paymentCounts(address borrower) view returns (uint256)",
];

type Network = typeof SEPOLIA;
type RelayerState = { watching: boolean; lastScannedBlock: number | null; lastHeartbeat: string | null };
type Passport = { score: number; payments: number; tier: string };

/** Reduce wallet and contract errors to a message useful in the status bar. */
function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "shortMessage" in error) return String(error.shortMessage);
  if (error instanceof Error) return error.message;
  return "The transaction could not be completed.";
}

/** Credit tiers intentionally use simple, transparent score boundaries. */
function scoreTier(score: number): string {
  if (score >= 650) return "Gold";
  if (score >= 600) return "Silver";
  if (score >= 550) return "Bronze";
  return "New";
}

export default function Dashboard() {
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState("Connect MetaMask to begin.");
  const [busy, setBusy] = useState("");
  const [mintAmount, setMintAmount] = useState("2000");
  const [borrower, setBorrower] = useState("");
  const [principal, setPrincipal] = useState("1000");
  const [amountDue, setAmountDue] = useState("1050");
  const [deadlineDays, setDeadlineDays] = useState("30");
  const [loanId, setLoanId] = useState("");
  const [repayment, setRepayment] = useState("100");
  const [passportAddress, setPassportAddress] = useState("");
  const [passport, setPassport] = useState<Passport | null>(null);
  const [relayer, setRelayer] = useState<RelayerState>({ watching: false, lastScannedBlock: null, lastHeartbeat: null });

  // Poll the local health endpoint independently of the connected wallet. This
  // indicator reflects whether the worker checkpoint has changed recently.
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/relayer-status", { cache: "no-store" });
        const next = (await response.json()) as RelayerState;
        if (active) setRelayer(next);
      } catch {
        if (active) setRelayer({ watching: false, lastScannedBlock: null, lastHeartbeat: null });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function ethereum(): Eip1193Provider {
    const injected = (window as typeof window & { ethereum?: Eip1193Provider }).ethereum;
    if (!injected) throw new Error("MetaMask was not detected in this browser.");
    return injected;
  }

  /** Ask MetaMask for accounts and retain only the public wallet address. */
  async function connectWallet() {
    try {
      const provider = new BrowserProvider(ethereum());
      const accounts = await provider.send("eth_requestAccounts", []);
      const selected = accounts[0] as string;
      setAccount(selected);
      setBorrower((current) => current || selected);
      setPassportAddress((current) => current || selected);
      setStatus("Wallet connected. Choose a Sepolia action.");
    } catch (error) { setStatus(errorMessage(error)); }
  }

  /** Switch networks, adding Creditcoin to MetaMask if it is not known yet. */
  async function signerOn(network: Network) {
    const injected = ethereum();
    try {
      await injected.request?.({ method: "wallet_switchEthereumChain", params: [{ chainId: network.chainId }] });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw error;
      await injected.request?.({ method: "wallet_addEthereumChain", params: [network] });
    }
    const provider = new BrowserProvider(injected);
    return provider.getSigner();
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    try { await action(); } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(""); }
  }

  /** Mint the demo ERC20 directly to the connected wallet on Sepolia. */
  function mintTokens() {
    return runAction("mint", async () => {
      const signer = await signerOn(SEPOLIA);
      const recipient = await signer.getAddress();
      setStatus("Confirm the TestToken faucet transaction in MetaMask...");
      const tx = await new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer).faucet(recipient, parseUnits(mintAmount, 18));
      await tx.wait();
      const balance = await new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer).balanceOf(recipient);
      setStatus(`Minted successfully. Balance: ${formatUnits(balance, 18)} atUSD.`);
    });
  }

  /**
   * Create and fund in one UI action. SimpleLoanBook requires lender approval
   * before funding, so this flow submits approval, creation, then funding.
   */
  function createLoan() {
    return runAction("create", async () => {
      if (!isAddress(borrower)) throw new Error("Enter a valid borrower address.");
      const signer = await signerOn(SEPOLIA);
      const principalUnits = parseUnits(principal, 18);
      const dueUnits = parseUnits(amountDue, 18);
      const deadline = Math.floor(Date.now() / 1000) + Number(deadlineDays) * 86_400;
      const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      const loanBook = new Contract(LOAN_BOOK_ADDRESS, LOAN_BOOK_ABI, signer);

      setStatus("Step 1/3: approve principal transfer...");
      await (await token.approve(LOAN_BOOK_ADDRESS, principalUnits)).wait();
      setStatus("Step 2/3: create the loan...");
      const creation = await loanBook.createLoan(borrower, TOKEN_ADDRESS, principalUnits, dueUnits, deadline);
      const receipt = await creation.wait();

      // Parse LoanCreated from the receipt instead of predicting the contract's
      // nonce-based loan identifier in the browser.
      const iface = new Interface(LOAN_BOOK_ABI);
      const createdLog = receipt.logs
        .map((log: { topics: readonly string[]; data: string }) => { try { return iface.parseLog(log); } catch { return null; } })
        .find((log: { name?: string } | null) => log?.name === "LoanCreated");
      if (!createdLog) throw new Error("LoanCreated event was not found in the transaction receipt.");
      const createdLoanId = String(createdLog.args.loanId);

      setStatus("Step 3/3: fund the new loan...");
      await (await loanBook.fundLoan(createdLoanId)).wait();
      setLoanId(createdLoanId);
      setStatus(`Loan created and funded. Loan ID: ${createdLoanId}`);
    });
  }

  /** Approve the exact payment and then emit LoanRepaid through repayLoan. */
  function repayLoan() {
    return runAction("repay", async () => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(loanId)) throw new Error("Enter a valid bytes32 loan ID.");
      const signer = await signerOn(SEPOLIA);
      const payment = parseUnits(repayment, 18);
      const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      const loanBook = new Contract(LOAN_BOOK_ADDRESS, LOAN_BOOK_ABI, signer);
      setStatus("Step 1/2: approve repayment tokens...");
      await (await token.approve(LOAN_BOOK_ADDRESS, payment)).wait();
      setStatus("Step 2/2: submit repayment...");
      await (await loanBook.repayLoan(loanId, payment)).wait();
      setStatus("Repayment confirmed. The relayer can now prove this event to Creditcoin.");
    });
  }

  /** Switch to Creditcoin and read reputation for any EVM-compatible address. */
  function fetchPassport() {
    return runAction("passport", async () => {
      if (!isAddress(passportAddress)) throw new Error("Enter a valid passport address.");
      const signer = await signerOn(CREDITCOIN);
      const contract = new Contract(PASSPORT_ADDRESS, PASSPORT_ABI, signer);
      setStatus("Reading verified repayment history from Creditcoin...");
      const [rawScore, rawPayments] = await Promise.all([
        contract.getScore(passportAddress),
        contract.paymentCounts(passportAddress),
      ]);
      const score = Number(rawScore);
      setPassport({ score, payments: Number(rawPayments), tier: scoreTier(score) });
      setStatus("Credit passport loaded from Creditcoin.");
    });
  }

  const configured = [TOKEN_ADDRESS, LOAN_BOOK_ADDRESS, PASSPORT_ADDRESS].every(isAddress);

  return (
    <main className="grid-paper min-h-screen px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <header className="mx-auto flex max-w-7xl flex-col gap-6 border-b border-[var(--ink)] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.28em]">Attestcoin-powered reputation</p>
          <h1 className="max-w-3xl text-5xl font-extrabold leading-[0.9] tracking-[-0.06em] sm:text-7xl">AttestLend<br/><span className="text-[var(--orange)]">Passport.</span></h1>
        </div>
        <button className="action min-w-48" onClick={connectWallet}>{account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect MetaMask"}</button>
      </header>

      <div className="mx-auto mt-8 grid max-w-7xl gap-7 lg:grid-cols-[1.6fr_0.75fr]">
        <section className="panel bg-[#fffdf7] p-5 sm:p-7 lg:row-span-2">
          <div className="mb-7 flex items-center justify-between gap-4">
            <div><p className="font-mono text-xs uppercase tracking-widest text-[var(--orange)]">01 / Sepolia</p><h2 className="text-3xl font-extrabold tracking-tight">Loan action desk</h2></div>
            <span className="rounded-full bg-[var(--acid)] px-3 py-1 font-mono text-xs">CHAIN 11155111</span>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <ActionCard number="A" title="Mint test assets" description="Fund your wallet with permissionless atUSD.">
              <Input label="Amount (atUSD)" value={mintAmount} onChange={setMintAmount}/>
              <button className="action w-full" disabled={!account || !!busy || !configured} onClick={mintTokens}>{busy === "mint" ? "Confirming..." : "Mint TestTokens"}</button>
            </ActionCard>

            <ActionCard number="B" title="Create a loan" description="Approve, create, and fund a fixed loan.">
              <Input label="Borrower" value={borrower} onChange={setBorrower} mono/>
              <div className="grid grid-cols-2 gap-2"><Input label="Principal" value={principal} onChange={setPrincipal}/><Input label="Amount due" value={amountDue} onChange={setAmountDue}/></div>
              <Input label="Deadline (days)" value={deadlineDays} onChange={setDeadlineDays}/>
              <button className="action w-full" disabled={!account || !!busy || !configured} onClick={createLoan}>{busy === "create" ? "Deploying capital..." : "Create & fund loan"}</button>
            </ActionCard>

            <ActionCard number="C" title="Record repayment" description="Approve payment and emit proof-ready history.">
              <Input label="Loan ID" value={loanId} onChange={setLoanId} mono/>
              <Input label="Payment (atUSD)" value={repayment} onChange={setRepayment}/>
              <button className="action w-full" disabled={!account || !!busy || !configured} onClick={repayLoan}>{busy === "repay" ? "Repaying..." : "Repay loan"}</button>
            </ActionCard>
          </div>
        </section>

        <section className="panel bg-[var(--ink)] p-6 text-white">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--acid)]">02 / Relay</p>
          <div className="mt-5 flex items-center gap-4">
            <span className={`relative h-5 w-5 rounded-full ${relayer.watching ? "bg-[var(--acid)]" : "bg-zinc-500"}`}>
              {relayer.watching && <span className="absolute inset-0 animate-ping rounded-full bg-[var(--acid)] opacity-50"/>}
            </span>
            <div><h2 className="text-2xl font-bold">{relayer.watching ? "Worker watching" : "Worker offline"}</h2><p className="text-sm text-white/55">Sepolia → Creditcoin</p></div>
          </div>
          <div className="mt-6 border-t border-white/15 pt-4 font-mono text-xs text-white/65">Last scanned block<br/><span className="text-lg text-white">{relayer.lastScannedBlock?.toLocaleString() ?? "No checkpoint"}</span></div>
        </section>

        <section className="panel bg-[var(--acid)] p-6">
          <div className="flex items-start justify-between"><div><p className="font-mono text-xs uppercase tracking-widest">03 / Creditcoin</p><h2 className="mt-1 text-3xl font-extrabold tracking-tight">Credit passport</h2></div><span className="text-4xl">↗</span></div>
          <div className="mt-5"><Input label="Borrower address" value={passportAddress} onChange={setPassportAddress} mono/></div>
          <button className="action mt-3 w-full" disabled={!account || !!busy || !configured} onClick={fetchPassport}>{busy === "passport" ? "Fetching..." : "Fetch passport"}</button>
          {passport && <div className="mt-5 grid grid-cols-3 divide-x divide-[var(--ink)] border-y border-[var(--ink)] py-4 text-center"><Metric label="Score" value={passport.score}/><Metric label="Tier" value={passport.tier}/><Metric label="Payments" value={passport.payments}/></div>}
        </section>
      </div>

      <footer className="mx-auto mt-8 max-w-7xl border border-[var(--ink)] bg-white/70 px-4 py-3 font-mono text-xs">
        <span className="mr-3 text-[var(--orange)]">SYSTEM</span>{configured ? status : "Deployment addresses are missing. Configure NEXT_PUBLIC contract addresses."}
      </footer>
    </main>
  );
}

function ActionCard({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <article className="flex min-h-80 flex-col border border-[var(--ink)] bg-[#f3f0e7]/60 p-4"><span className="mb-6 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--orange)] font-mono text-sm text-white">{number}</span><h3 className="text-xl font-extrabold">{title}</h3><p className="mb-5 mt-1 text-sm text-[var(--ink)]/60">{description}</p><div className="mt-auto space-y-3">{children}</div></article>;
}

function Input({ label, value, onChange, mono = false }: { label: string; value: string; onChange: (value: string) => void; mono?: boolean }) {
  return <label className="block text-xs font-bold uppercase tracking-wide"><span className="mb-1 block">{label}</span><input className={`field normal-case ${mono ? "font-mono text-xs" : ""}`} value={value} onChange={(event) => onChange(event.target.value)}/></label>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="font-mono text-[10px] uppercase tracking-wider">{label}</p><p className="mt-1 text-xl font-extrabold">{value}</p></div>;
}
