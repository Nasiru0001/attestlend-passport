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
   deployed contract, and relayer private key values. `START_BLOCK` is
   optional: when omitted on a fresh install, the worker starts at the current
   source head minus 100.

3. Start the worker from the repository root:

   ```bash
   npm --prefix worker start
   ```

The worker writes its restart checkpoint to `worker/state.json`. It advances
that file only after all matching transactions in a scanned block window have
been attested, proven, and submitted successfully. Delete the checkpoint only
when intentionally replaying from the resolved initial block.

## RPC range limit

Each `eth_getLogs` request covers at most five inclusive blocks. This is below
the ten-block limit imposed by the free Sepolia RPC provider. `MAX_BLOCK_RANGE`
is capped in code at five even if a larger value is supplied in `.env`.

## Important integration detail

`CreditPassport.execute` must receive the SDK's `txBytes` unchanged. Those bytes
are part of the cryptographic proof verified by Creditcoin. The passport's
application decoder must therefore decode the transaction/receipt format
produced by the Attestcoin SDK and extract the `LoanRepaid` receipt log; it must
not expect a separately ABI-encoded `(sourceContract, topics, data)` tuple.
