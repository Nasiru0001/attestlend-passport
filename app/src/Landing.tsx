type LandingProps = {
  onLaunch: () => void;
};

const features = [
  {
    number: "01",
    title: "Trustless Cross-Chain Verification",
    description: "Repayment events are proven through Attestcoin instead of trusted intermediaries.",
  },
  {
    number: "02",
    title: "On-Chain Credit Scoring",
    description: "Verified payment history becomes a transparent, durable score on Creditcoin.",
  },
  {
    number: "03",
    title: "Composable DeFi Reputation",
    description: "A portable passport gives lending applications a shared source of borrower history.",
  },
];

/** Introductory view shown before the user enters the interactive dashboard. */
export default function Landing({ onLaunch }: LandingProps) {
  return (
    <main className="grid-paper min-h-screen px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <nav className="mx-auto flex max-w-7xl items-center justify-between border-b border-[var(--ink)] pb-5">
        <div className="flex items-center gap-3">
          <img src="public/logo.png" alt="AttestLend" className="h-8 w-8" />
          <span className="text-sm font-extrabold uppercase tracking-tight">AttestLend</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--ink)]/55">
          Built on Creditcoin
        </span>
      </nav>

      <section className="mx-auto grid min-h-[calc(100vh-9rem)] max-w-7xl items-center gap-12 py-14 lg:grid-cols-[1.25fr_0.75fr] lg:py-20">
        <div>
          <p className="mb-5 font-mono text-xs font-medium uppercase tracking-[0.28em] text-[var(--orange)]">
            Cross-Chain Credit Reputation
          </p>
          <h1 className="max-w-4xl text-6xl font-extrabold leading-[0.86] tracking-[-0.065em] sm:text-8xl lg:text-[7.5rem]">
            AttestLend
            <br />
            <span className="text-[var(--orange)]">Passport.</span>
          </h1>

          <p className="mt-8 max-w-2xl text-base leading-7 text-[var(--ink)]/68 sm:text-lg sm:leading-8">
            AttestLend uses the Attestcoin Protocol to verify DeFi loan repayments from Ethereum
            Sepolia and permanently record them to a user&apos;s passport on Creditcoin, without relying
            on centralized oracles.
          </p>

          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <button className="action min-w-52 px-7 py-4 text-base" onClick={onLaunch}>
              Launch App <span className="ml-3">→</span>
            </button>
            <p className="font-mono text-[10px] uppercase leading-5 tracking-[0.18em] text-[var(--ink)]/50">
              Sepolia repayment facts
              <br />become Creditcoin reputation
            </p>
          </div>
        </div>

        <aside className="panel bg-[#fffdf7] p-5 sm:p-7">
          <div className="mb-6 flex items-center justify-between border-b border-[var(--ink)]/20 pb-4">
            <p className="font-mono text-xs uppercase tracking-[0.2em]">Protocol capabilities</p>
            <span className="h-3 w-3 rounded-full bg-[var(--acid)] ring-4 ring-[var(--acid)]/30" />
          </div>

          <ul className="space-y-3">
            {features.map((feature) => (
              <li
                key={feature.number}
                className="grid grid-cols-[2.5rem_1fr] gap-3 border border-[var(--ink)]/15 bg-[var(--paper)]/65 p-4"
              >
                <span className="font-mono text-xs font-medium text-[var(--orange)]">{feature.number}</span>
                <div>
                  <h2 className="font-extrabold leading-5">{feature.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink)]/58">{feature.description}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 grid grid-cols-3 divide-x divide-[var(--ink)] border-y border-[var(--ink)] py-4 text-center">
            <ProtocolMetric label="Source" value="Sepolia" />
            <ProtocolMetric label="Proof" value="Attestcoin" />
            <ProtocolMetric label="Passport" value="Creditcoin" />
          </div>
        </aside>
      </section>
    </main>
  );
}

function ProtocolMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink)]/50">{label}</p>
      <p className="mt-1 text-xs font-extrabold sm:text-sm">{value}</p>
    </div>
  );
}
