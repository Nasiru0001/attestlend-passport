# AttestLend Proof Relayer

This worker watches `SimpleLoanBook.LoanRepaid` events on Ethereum Sepolia and
relays one Attestcoin proof per source transaction to `CreditPassport` on
Creditcoin.

## Setup

1. Install dependencies from this directory:

   ```bash
   cd worker
   npm install
   ```

2. Copy `.env.example` to the repository root as `.env` and fill in the RPC,
   deployed contract, source-chain start block, and relayer private key values.

3. Start the worker from the repository root:

   ```bash
   npm --prefix worker start
   ```

The worker writes its restart checkpoint to `worker/state.json`. It advances
that file only after all matching transactions in a scanned block window have
been attested, proven, and submitted successfully. Delete the checkpoint only
when intentionally replaying from `START_BLOCK`.

## Important integration detail

`CreditPassport.execute` must receive the SDK's `txBytes` unchanged. Those bytes
are part of the cryptographic proof verified by Creditcoin. The passport's
application decoder must therefore decode the transaction/receipt format
produced by the Attestcoin SDK and extract the `LoanRepaid` receipt log; it must
not expect a separately ABI-encoded `(sourceContract, topics, data)` tuple.
