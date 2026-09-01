import { useEffect, useState, type ReactNode } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  BrowserProvider,
  Contract,
  Interface,
  MaxUint256,
  formatUnits,
  isAddress,
  parseUnits,
} from "ethers";
import Landing from "./Landing";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { creditcoinTestnet } from "./wagmiConfig";

// These are the deployed Sepolia addresses used by the demo. Keep these
// explicit so approval and loan calls cannot silently target different
// contracts through a stale or malformed environment override.
const TOKEN_ADDRESS = "0xdc3ec400daD10FFb16ed091B49F7D00F148b8002";
const LOAN_BOOK_ADDRESS = "0x3aed94d0ba078d3Cda6342317E1B3117bB0adc38";
const PASSPORT_ADDRESS = import.meta.env.VITE_CREDIT_PASSPORT_ADDRESS ?? "0xd62312a5F30871303D95B49f3D331e65CA972ab7";

const TOKEN_ABI = [
  "function faucet(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const LOAN_BOOK_ABI = [
  "function createLoan(address borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline) returns (bytes32 loanId)",
  "function fundLoan(bytes32 loanId)",
  "function repayLoan(bytes32 loanId, uint256 paymentAmount) returns (bool fullyRepaid)",
  "event LoanCreated(bytes32 indexed loanId, address indexed lender, address indexed borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline)",
  "error InvalidAmountDue(uint256 principal, uint256 amountDue)",
  "error InvalidDeadline(uint256 deadline, uint256 currentTime)",
  "error ZeroAddress()",
  "error ZeroAmount()",
];

const PASSPORT_ABI = [
  "function getScore(address borrower) view returns (uint256)",
  "function paymentCounts(address borrower) view returns (uint256)",
];

type Passport = { score: number; payments: number; tier: string };
type View = "landing" | "dashboard";

/** Reduce wallet and contract errors to a message useful in the status bar. */
function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "reason" in error && error.reason) return String(error.reason);
  if (typeof error === "object" && error && "shortMessage" in error) return String(error.shortMessage);
  if (error instanceof Error) return error.message;
  return "The transaction could not be completed.";
}

/**
 * Decode a Solidity custom error or return ethers' own readable reason. RPC
 * providers put revert data in different nested fields, so check the common
 * locations before giving the user a generic execution-reverted message.
 */
function decodeRevertReason(error: unknown): string {
  const candidate = error as {
    reason?: string;
    shortMessage?: string;
    data?: string | { data?: string };
    error?: { data?: string };
  };
  const rawData = typeof candidate.data === "string"
    ? candidate.data
    : typeof candidate.data?.data === "string"
      ? candidate.data.data
      : candidate.error?.data;

  if (rawData && rawData !== "0x") {
    try {
      const parsed = new Interface(LOAN_BOOK_ABI).parseError(rawData);
      if (parsed) return `${parsed.name}(${parsed.args.map(String).join(", ")})`;
    } catch {
      // The provider may return a non-Solidity or differently encoded payload.
    }
  }

  return candidate.reason ?? candidate.shortMessage ?? errorMessage(error);
}

/** Credit tiers intentionally use simple, transparent score boundaries. */
function scoreTier(score: number): string {
  if (score >= 650) return "Gold";
  if (score >= 600) return "Silver";
  if (score >= 550) return "Bronze";
  return "New";
}

/** Truncate a wallet address for display. Shows first 6 chars, then ellipsis, then last 6 chars. */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export default function App() {
  const [view, setView] = useState<View>("landing");

  if (view === "landing") {
    return <Landing onLaunch={() => setView("dashboard")} />;
  }

  return <Dashboard />;
}

function Dashboard() {
  const { address: account, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [status, setStatus] = useState("Connect MetaMask to begin.");
  const [busy, setBusy] = useState("");
  const [mintAmount, setMintAmount] = useState("2000");
  const [borrower, setBorrower] = useState("");
  const [principal, setPrincipal] = useState("1000");
  const [amountDue, setAmountDue] = useState("1050");
  const [deadlineDays, setDeadlineDays] = useState("30");
  const [loanId, setLoanId] = useState("");
  const [createdLoanNotice, setCreatedLoanNotice] = useState("");
  const [repayment, setRepayment] = useState("100");
  const [passportAddress, setPassportAddress] = useState("");
  const [passport, setPassport] = useState<Passport | null>(null);

  // Wagmi updates this hook whenever RainbowKit changes the connected wallet.
  // Mirror it into the editable form defaults without owning wallet state here.
  useEffect(() => {
    if (!account) return;
    setBorrower(account);
    setPassportAddress(account);
    setLoanId("");
    setCreatedLoanNotice("");
    setPassport(null);
  }, [account]);

  async function signerOn(target: "sepolia" | "creditcoin") {
    if (!walletClient || !account || !isConnected) throw new Error("Connect a wallet before continuing.");
    const targetChainId = target === "sepolia" ? 11155111 : creditcoinTestnet.id;
    if (chainId !== targetChainId) {
      await switchChainAsync({ chainId: targetChainId });
      throw new Error("Network switched. Click the action again after the wallet updates.");
    }
    const provider = new BrowserProvider(walletClient.transport);
    return provider.getSigner(account);
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    try { await action(); } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(""); }
  }

  /** Mint the demo ERC20 directly to the connected wallet on Sepolia. */
  function mintTokens() {
    return runAction("mint", async () => {
      const signer = await signerOn("sepolia");
      const recipient = await signer.getAddress();
      setStatus("Confirm the TestToken faucet transaction in MetaMask...");
      const tx = await new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer).faucet(recipient, parseUnits(mintAmount, 18));
      await tx.wait();
       const balance = await new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer).balanceOf(recipient);
       setStatus(`Minted successfully. Balance: ${formatUnits(balance, 18)} atUSD. Address: ${truncateAddress(account)}`);
    });
  }

  /**
   * Create and fund in one UI action. SimpleLoanBook requires lender approval
   * before funding, so this flow submits approval, creation, then funding.
   */
  function createLoan() {
    return runAction("create", async () => {
      if (!isAddress(borrower)) throw new Error("Enter a valid borrower address.");
      setCreatedLoanNotice("");
      const signer = await signerOn("sepolia");
      const signerAddress = await signer.getAddress();
      const principalUnits = parseUnits(principal, 18);
      const dueUnits = parseUnits(amountDue, 18);
      const deadline = Math.floor(Date.now() / 1000) + Number(deadlineDays) * 86_400;
      const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      const loanBook = new Contract(LOAN_BOOK_ADDRESS, LOAN_BOOK_ABI, signer);

      setStatus("Checking TestToken allowance...");
      const allowance = await token.allowance(signerAddress, LOAN_BOOK_ADDRESS);
      if (allowance < principalUnits) {
        setStatus("Approve TestTokens in MetaMask...");
        const approvalTx = await token.approve(LOAN_BOOK_ADDRESS, MaxUint256);
        await approvalTx.wait();
      }

      setStatus("Checking TestToken balance...");
       const balance = await token.balanceOf(signerAddress);
       console.log("Create Loan TestToken balance:", {
         address: signerAddress,
         balance: balance.toString(),
         balanceFormatted: formatUnits(balance, 18),
         principal: principalUnits.toString(),
         principalFormatted: formatUnits(principalUnits, 18),
         truncatedAddress: truncateAddress(signerAddress),
       });

      try {
        // Simulate with the same connected signer before sending. This catches
        // InvalidDeadline, InvalidAmountDue, bad addresses, and any allowance
        // problem before MetaMask broadcasts a transaction.
        setStatus("Simulating loan creation...");
        await loanBook.createLoan.staticCall(
          borrower,
          TOKEN_ADDRESS,
          principalUnits,
          dueUnits,
          deadline,
        );

        setStatus("Confirm loan creation in MetaMask...");
        const creation = await loanBook.createLoan(borrower, TOKEN_ADDRESS, principalUnits, dueUnits, deadline);
        const receipt = await creation.wait();
        if (!receipt) throw new Error("Loan creation transaction did not produce a receipt.");

        // LoanCreated.loanId is bytes32 and is intentionally a hash in
        // SimpleLoanBook, not a sequential integer. Keep the hash in the input
        // for repayLoan and show its decimal uint256 form in the notice.
        const iface = new Interface(LOAN_BOOK_ABI);
        const createdLog = receipt.logs
          .map((log: { topics: readonly string[]; data: string }) => {
            try { return iface.parseLog(log); } catch { return null; }
          })
          .find((log: { name?: string } | null) => log?.name === "LoanCreated");
        if (!createdLog) throw new Error("LoanCreated event was not found in the transaction receipt.");
        const createdLoanId = String(createdLog.args.loanId);
        const numericLoanId = BigInt(createdLoanId).toString(10);

        setStatus("Funding the new loan...");
        await (await loanBook.fundLoan(createdLoanId)).wait();
        setLoanId(createdLoanId);
        setCreatedLoanNotice(`Loan #${numericLoanId} created!`);
        setStatus("Loan created and funded. The Loan ID is ready in the repayment form.");
      } catch (error) {
        const reason = decodeRevertReason(error);
        console.error("createLoan reverted", {
          reason,
          rawError: error,
          signerAddress,
          balance: balance.toString(),
          principal: principalUnits.toString(),
          amountDue: dueUnits.toString(),
          deadline,
        });
        setStatus(`Create Loan failed: ${reason}`);
        return;
      }
    });
  }

  /** Approve the exact payment and then emit LoanRepaid through repayLoan. */
  function repayLoan() {
    return runAction("repay", async () => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(loanId)) throw new Error("Enter a valid bytes32 loan ID.");
      const signer = await signerOn("sepolia");
      const signerAddress = await signer.getAddress();
      const payment = parseUnits(repayment, 18);
      const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      const loanBook = new Contract(LOAN_BOOK_ADDRESS, LOAN_BOOK_ABI, signer);
      setStatus("Checking TestToken repayment allowance...");
      const allowance = await token.allowance(signerAddress, LOAN_BOOK_ADDRESS);
      if (allowance < payment) {
        setStatus("Approve repayment TestTokens in MetaMask...");
        const approvalTx = await token.approve(LOAN_BOOK_ADDRESS, payment);
        await approvalTx.wait();
      }

      try {
        setStatus("Simulating repayment...");
        await loanBook.repayLoan.staticCall(loanId, payment);
        setStatus("Confirm repayment in MetaMask...");
        await (await loanBook.repayLoan(loanId, payment)).wait();
        setStatus("Repayment confirmed. The relayer can now prove this event to Creditcoin.");
      } catch (error) {
        const reason = decodeRevertReason(error);
        console.error("repayLoan reverted", { reason, rawError: error, signerAddress, loanId, payment: payment.toString() });
        setStatus(`Repayment failed: ${reason}`);
      }
    });
  }

  /** Switch to Creditcoin and read reputation for any EVM-compatible address. */
  function fetchPassport() {
    return runAction("passport", async () => {
      if (!isAddress(passportAddress)) throw new Error("Enter a valid passport address.");
      const signer = await signerOn("creditcoin");
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
        <div className="flex items-center gap-3">
          <img src="public/logo.png" alt="AttestLend" className="h-8 w-8" />
          <div>
            <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.28em]">Attestcoin-powered reputation</p>
            <h1 className="max-w-3xl text-5xl font-extrabold leading-[0.9] tracking-[-0.06em] sm:text-7xl">AttestLend<br/><span className="text-[var(--orange)]">Passport.</span></h1>
          </div>
        </div>
        {account && (
           <div className="mt-5 max-w-full border-l-4 border-[var(--orange)] pl-3 ">
             <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink)]/55">Active wallet</p>
             <p className="mt-1 break-all font-mono text-xs font-medium sm:text-sm">{truncateAddress(account)}</p>
           </div>
        )}
        <ConnectButton />
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
              <Input
                label="Borrower Address"
                value={borrower}
                onChange={setBorrower}
                placeholder="0x..."
                mono
              />
              <div className="grid grid-cols-2 gap-2"><Input label="Principal" value={principal} onChange={setPrincipal}/><Input label="Amount due" value={amountDue} onChange={setAmountDue}/></div>
              <Input label="Deadline (days)" value={deadlineDays} onChange={setDeadlineDays}/>
              <button className="action w-full" disabled={!account || !!busy || !configured} onClick={createLoan}>
                {busy === "create" ? "Checking approval..." : "Create Loan"}
              </button>
            </ActionCard>

            <ActionCard number="C" title="Record repayment" description="Approve payment and emit proof-ready history.">
           {createdLoanNotice && (
                 <p
                   className="border border-[var(--ink)] bg-[var(--acid)] px-3 py-2 font-mono text-[10px] font-medium normal-case tracking-normal"
                   role="status"
                 >
                   {createdLoanNotice}
                 </p>
               )}
              <Input
                label="Loan ID"
                value={loanId}
                onChange={setLoanId}
                placeholder="0x... bytes32 loan ID"
                mono
              />
              <Input label="Payment (atUSD)" value={repayment} onChange={setRepayment}/>
              <button className="action w-full" disabled={!account || !!busy || !configured} onClick={repayLoan}>
                {busy === "repay" ? "Checking approval..." : "Repay Loan"}
              </button>
            </ActionCard>
          </div>
        </section>

        <section className="panel bg-[var(--ink)] p-6 text-white">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--acid)]">02 / Relay</p>
          <div className="mt-5 flex items-center gap-4">
            <span className="relative h-5 w-5 rounded-full bg-[var(--acid)]">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--acid)] opacity-50"/>
            </span>
            <div><h2 className="text-2xl font-bold">Worker Online</h2><p className="text-sm text-white/55">Sepolia → Creditcoin</p></div>
          </div>
          <div className="mt-6 border-t border-white/15 pt-4 font-mono text-xs text-white/65">Relayer mode<br/><span className="text-lg text-white">Demo active</span></div>
        </section>

        <section className="panel bg-[var(--acid)] p-6">
          <div className="flex items-start justify-between"><div><p className="font-mono text-xs uppercase tracking-widest">03 / Creditcoin</p><h2 className="mt-1 text-3xl font-extrabold tracking-tight">Credit passport</h2></div><span className="text-4xl">↗</span></div>
          <div className="mt-5"><Input label="Borrower address" value={passportAddress} onChange={setPassportAddress} mono/></div>
          <button className="action mt-3 w-full" disabled={!account || !!busy || !configured} onClick={fetchPassport}>{busy === "passport" ? "Fetching..." : "Fetch passport"}</button>
          {passport && <div className="mt-5 grid grid-cols-3 divide-x divide-[var(--ink)] border-y border-[var(--ink)] py-4 text-center"><Metric label="Score" value={passport.score}/><Metric label="Tier" value={passport.tier}/><Metric label="Payments" value={passport.payments}/></div>}
        </section>
      </div>

      <footer className="mx-auto mt-8 max-w-7xl border border-[var(--ink)] bg-white/70 px-4 py-3 font-mono text-xs">
        <span className="mr-3 text-[var(--orange)]">SYSTEM</span>{configured ? status : "Deployment addresses are missing. Configure VITE contract addresses."}
      </footer>
    </main>
  );
}

function ActionCard({ number, title, description, children }: { number: string; title: string; description: string; children: ReactNode }) {
  return <article className="flex min-h-80 flex-col border border-[var(--ink)] bg-[#f3f0e7]/60 p-4"><span className="mb-6 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--orange)] font-mono text-sm text-white">{number}</span><h3 className="text-xl font-extrabold">{title}</h3><p className="mb-5 mt-1 text-sm text-[var(--ink)]/60">{description}</p><div className="mt-auto space-y-3">{children}</div></article>;
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide">
      <span className="mb-1 block">{label}</span>
      <input
        type="text"
        className={`field normal-case ${mono ? "font-mono text-xs" : ""}`}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="font-mono text-[10px] uppercase tracking-wider">{label}</p><p className="mt-1 text-xl font-extrabold">{value}</p></div>;
}
