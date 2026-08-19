# AttestLend Passport

AttestLend Passport is a hackathon DeFi prototype that turns loan repayments on Ethereum Sepolia into a verifiable borrower repayment history on Creditcoin. The Attestcoin Protocol proves the source transaction before the Creditcoin passport contract records it.

## Project Structure

```text
contracts/source/      Sepolia token and loan contracts
contracts/creditcoin/  Attestcoin consumer and borrower passport contracts
contracts/test/        Foundry contract tests
worker/                Proof-generation and relay service
scripts/               Deployment and interaction scripts
app/                   Borrower passport web application
deployments/           Generated testnet deployment records
```

## Current Milestone

Day 1 implements the source-chain contracts:

- `TestToken`: a small ERC20-compatible test asset with a public faucet.
- `SimpleLoanBook`: fixed-term bilateral loans with partial repayment events designed for Attestcoin proofs.

## Development

Install the Foundry test dependency if it is not already present:

```bash
forge install foundry-rs/forge-std --no-git
```

Build and test the contracts:

```bash
forge build
forge test
```
