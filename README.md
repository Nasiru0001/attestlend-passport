# AttestLend Passport 🎫

**Credit Reputation Protocol on Creditcoin**

AttestLend Passport is a cross-chain credit reputation protocol that enables users to build a verified "Credit Passport" on Creditcoin based on their DeFi activity on other blockchains using the Attestcoin Protocol.

---

## 📋 Overview

AttestLend Passport bridges the gap between DeFi activity on Ethereum Sepolia and Creditcoin's credit ecosystem. The protocol validates and records borrower repayment histories across chains, establishing verifiable credit scores on Creditcoin.

**Key Features:**
- Cross-chain repayment verification via Attestcoin Protocol
- Dynamic credit scoring system (Start: 500, +10 per payment, +50 per full repayment)
- Decentralized trust establishment for unbanked borrowers
- Proof-based transaction validation on Creditcoin

---

## 🚩 The Problem

**Traditional Credit Scoring Barriers:**

- ❌ **Fragmented Data**: Credit histories exist in silos across different blockchain networks and DeFi protocols
- ❌ **No Cross-Chain Recognition**: Users' DeFi activities on Ethereum cannot automatically improve their Creditcoin scores
- ❌ **Redundant Verification**: Each credit protocol requires independent proof of repayment history
- ❌ **Financial Exclusion**: Millions of DeFi users have no established credit reputation on Creditcoin
- ❌ **Manual Processes**: Tracking and verifying repayments across chains requires manual reconciliation

**The Challenge:** How do we create a unified credit scoring system on Creditcoin that recognizes and validates DeFi repayment activity from other chains in a secure, decentralized manner?

---

## 💡 The Solution

AttestLend Passport creates a **verifiable cross-chain credit reputation** system:

✅ **Attestcoin Protocol Integration**: Cryptographic proofs validate source transactions
✅ **Smart Contract-Based Scoring**: Immutable credit history on Creditcoin
✅ **Automated Proof Generation**: Off-chain relayer processes repayments in real-time
✅ **Decentralized Verification**: Native Creditcoin precompile ensures transaction validity
✅ **Self-Improving Credit**: Every verified repayment incrementally improves borrower scores

The system transforms loan repayments on Sepolia into verified credit events on Creditcoin, creating a continuous improvement loop for borrower creditworthiness.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DEFI ECOSYSTEM                            │
│   ┌─────────────────┐     ┌─────────────────┐                   │
│   │   TestToken     │     │   SimpleLoanBook │                   │
│   │   ERC20 Token   │     │   Loan Contracts │                   │
│   └────────┬────────┘     └────────┬────────┘                   │
│            │                      │                            │
│            │  Lender creates loan │                            │
│            └──────────┬───────────┘                            │
│                       │                                        │
│                  💰 Funded                                     │
│                       │                                        │
│            ┌──────────▼───────────┐                            │
│            │   LoanRepaid Event   │                            │
│            │   (emitted)          │                            │
│            └──────────┬───────────┘                            │
│                       │                                        │
└───────────────────────┼────────────────────────────────────────┘
                        │
        ┌───────────────▼───────────────┐
        │   ⚙️  TypeScript Relayer       │
        │   (Sepolia RPC + Attestcoin SDK)│
        │                               │
        │  1. Listen for LoanRepaid events│
        │  2. Wait for block attestation │
        │  3. Generate Merkle proof      │
        │  4. Verify via Attestcoin precompile│
        │  5. Submit to Creditcoin      │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼───────────────┐
        │   🌐 Creditcoin CC3 Testnet    │
        │   ┌─────────────────────────┐  │
        │   │ CreditPassport Contract │  │
        │   │                         │  │
        │   │ • Verifier: 0x0FD2...   │  │
        │   │ • LoanBook: 0x3aed...   │  │
        │   │                         │  │
        │   │ Credit Score Logic:     │  │
        │   │ • INITIAL_SCORE: 500    │  │
        │   │ • +10 per payment       │  │
        │   │ • +50 per full repayment│  │
        │   └─────────────────────────┘  │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼───────────────┐
        │   🎯 Frontend Dashboard       │
        │   Vite + React + RainbowKit   │
        │   • Mint Test Tokens          │
        │   • Create Loans              │
        │   • Repay Loans               │
        │   • View Credit Scores        │
        └───────────────────────────────┘
```

---

## 📜 Smart Contracts

### Source Chain (Sepolia Testnet)

#### TestToken
- **Purpose**: ERC20-compatible test asset for loan transactions
- **Features**: Public faucet for easy testing
- **Network**: Ethereum Sepolia Testnet
- **Address**: `0xdc3ec400daD10FFb16ed091B49F7D00F148b8002`

#### SimpleLoanBook
- **Purpose**: Fixed-term bilateral loan management
- **Features**:
  - Create, fund, repay, and cancel loans
  - Emits `LoanRepaid` event for proof generation
  - Repayment deadline enforcement
  - Partial repayment support
- **Network**: Ethereum Sepolia Testnet
- **Address**: `0x3aed94d0ba078d3Cda6342317E1B3117bB0adc38`

### Destination Chain (Creditcoin CC3 Testnet)

#### CreditPassport
- **Purpose**: Credit scoring contract that verifies and records repayments
- **Features**:
  - Receives cryptographic proofs via `AttestcoinConsumer`
  - Validates source transactions using native Creditcoin precompile
  - Updates borrower credit scores based on verified repayments
  - Implements replay protection via `processedQueries` mapping
- **Network**: Creditcoin CC3 Testnet
- **Address**: `0xd62312a5F30871303D95B49f3D331e65CA972ab7`
- **Constructor Args**:
  - Verifier: `0x0000000000000000000000000000000000000FD2`
  - Source LoanBook: `0x3aed94d0ba078d3Cda6342317E1B3117bB0adc38`

#### AttestcoinConsumer
- **Purpose**: Base contract providing proof verification and replay protection
- **Features**:
  - Integration with Creditcoin native verifier precompile
  - Transaction proof verification before application logic
  - Query ID-based replay protection
  - Hooks for application-specific processing

#### VerifierInterface
- **Purpose**: Interface for Creditcoin native verifier
- **Usage**: Ensures compatibility with Creditcoin's verification system

---

## 🚀 How to Run Locally

### Prerequisites

- Node.js 18+ installed
- Foundry (for Solidity development)
- Git
- Animate your patience (the demo is exciting!)

### Project Setup

```bash
# Clone the repository
git clone <repository-url>
cd attestlend-passport

# Install dependencies
cd app && npm install && cd ..
cd contracts && forge install foundry-rs/forge-std --no-git && cd ..
cd worker && npm install && cd ..
```

### Environment Configuration

Create `.env` files in each directory:

**`.env` (app/):**
```bash
VITE_WALLET_CONNECT_PROJECT_ID=your_project_id
```

**`.env` (worker/):**
```bash
SOURCE_CHAIN_RPC_URL=https://rpc.sepolia.org
CREDITCOIN_RPC_URL=<your_creditcoin_rpc>
PROOF_BUILDER_URL=https://api.gluwa.com/v2/usc/proof-builder
DEPLOYER_PRIVATE_KEY=<your_private_key>
SOURCE_CHAIN_KEY=11155111
SOURCE_LOAN_BOOK_ADDRESS=0x3aed94d0ba078d3Cda6342317E1B3117bB0adc38
CREDIT_PASSPORT_ADDRESS=0xd62312a5F30871303D95B49f3D331e65CA972ab7
SOURCE_CONFIRMATIONS=12
SCAN_INTERVAL_MS=15000
MAX_BLOCK_RANGE=5
```

### Development Workflows

#### 1. Deploy Smart Contracts

```bash
# Deploy source chain contracts (Sepolia)
cd contracts
forge script scripts/deploy-source.ts --rpc-url $SOURCE_CHAIN_RPC_URL --broadcast --verify

# Deploy Creditcoin contract
forge script scripts/deploy-creditcoin.ts --rpc-url $CREDITCOIN_RPC_URL --broadcast --verify
```

#### 2. Start the Frontend

```bash
cd app
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

#### 3. Run the Worker

```bash
cd worker
npm start
```

The worker will continuously monitor Sepolia for LoanRepaid events and process them to Creditcoin.

#### 4. Run Tests

```bash
# Foundry tests for contracts
cd contracts
forge test

# TypeScript tests
cd app
npm test
```

---

## 🔐 Attestcoin Protocol Integration

### How It Works

The Attestcoin Protocol provides cryptographic proof of source transaction validity on Creditcoin:

1. **Event Monitoring**: Worker listens for `LoanRepaid` events on Sepolia
2. **Attestation Waiting**: Worker waits for Creditcoin to attest the source block
3. **Proof Generation**: Attestcoin SDK generates Merkle proof for the transaction
4. **Verification**: Creditcoin native precompile verifies the proof
5. **Score Update**: CreditPassport contract processes verified transaction and updates score

### Key Components

#### 1. TypeScript Relayer (Worker)
- **Location**: `worker/src/index.ts`
- **Features**:
  - Polls Sepolia for LoanRepaid events
  - Waits for block attestation via `proofBuilder.waitUntilHeightAttested()`
  - Generates Merkle proofs via `proofBuilder.getProof()`
  - Submits proofs to Creditcoin CreditPassport contract

#### 2. Attestcoin SDK
- **Package**: `@gluwa/usc-sdk`
- **Usage**:
  ```typescript
  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, url, pollInterval);
  await proofBuilder.waitUntilHeightAttested(chainKey, blockHeight);
  const result = await proofBuilder.getProof(transactionHash);
  ```

#### 3. Creditcoin Native Verifier
- **Precompile Address**: `0x0000000000000000000000000000000000000FD2`
- **Contract**: `INativeQueryVerifier`
- **Verification Method**: `verifyAndEmit()`
- **Proof Types**:
  - MerkleProof: Transaction membership in block
  - ContinuityProof: Block continuity to attested endpoint

#### 4. Replay Protection
- **Mechanism**: `processedQueries` mapping tracks query IDs
- **Query ID Format**: `keccak256(abi.encode(chainKey, blockHeight, txIndex))`
- **Protection**: Prevents duplicate processing of same transaction

### Technical Details

#### Transaction Encoding
CreditPassport expects transactions in format: `abi.encode(sourceContract, topics, data)`

```typescript
const encodedTransaction = abiCoder.encode(
  ["address", "bytes32[]", "bytes"],
  [sourceContract, topics, data]
);
```

#### Event Decoding
```typescript
const event = simpleLoanBook.interface.parseLog(logs[0]);
const topics = [event.topics[0], event.topics[1], event.topics[2]];
const data = event.data;
```

#### Score Calculation
```solidity
uint256 newScore = currentScore + PAYMENT_SCORE_INCREMENT; // +10
if (fullyRepaid) newScore += FULL_REPAYMENT_SCORE_INCREMENT; // +50
```

---

## 📊 Credit Score System

### Scoring Logic

- **Initial Score**: 500 points
- **Partial Payment**: +10 points
- **Full Repayment**: +50 points (on top of payment points)

### Example Scenarios

| Repayment History | Final Score |
|-------------------|-------------|
| No payments | 500 |
| 1 partial payment | 510 |
| 1 full repayment | 560 |
| 3 partial, 1 full | 640 |
| 5 partial, 2 full | 720 |

### Score Benefits

- ✅ Lower interest rates on Creditcoin loans
- ✅ Higher loan limits
- ✅ Better borrowing terms
- ✅ Trust building in DeFi ecosystem
- ✅ Cross-chain financial integration

---

## 🎨 Frontend Features

The Vite + React dashboard provides:

- **Wallet Connection**: RainbowKit integration for seamless user experience
- **Token Management**: Mint and transfer TestToken
- **Loan Creation**: Create fixed-term loans with custom parameters
- **Loan Funding**: Lenders can fund created loans
- **Loan Repayment**: Borrowers can make partial or full payments
- **Score Monitoring**: Real-time credit score updates
- **Transaction History**: View all repayments and score changes

### Tech Stack

- **Framework**: React 19
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Wallet Connect**: RainbowKit
- **Providers**: Wagmi, Viem, Ethers v6
- **State Management**: TanStack React Query

---

## 🧪 Testing

### Contract Tests

```bash
cd contracts
forge test -vvv
```

### Integration Tests

```bash
# Test complete loan flow
npm run test:flow

# Test repayment flow
npm run test:repay
```

### Frontend Tests

```bash
cd app
npm test
```

---

## 📦 Deployment Status

### Current Networks

| Network | Status | Chain ID |
|---------|--------|----------|
| Ethereum Sepolia Testnet | ✅ Deployed | 11155111 |
| Creditcoin CC3 Testnet | ✅ Deployed | 102031 |

### Contract Addresses

| Contract | Network | Address |
|----------|---------|---------|
| TestToken | Sepolia | 0xdc3ec400daD10FFb16ed091B49F7D00F148b8002 |
| SimpleLoanBook | Sepolia | 0x3aed94d0ba078d3Cda6342317E1B3117bB0adc38 |
| CreditPassport | Creditcoin CC3 | 0xd62312a5F30871303D95B49f3D331e65CA972ab7 |

---

## 🎯 Use Cases

### For Borrowers
- Build credit history from DeFi activities
- Access better loan terms on Creditcoin
- Gain trust in the DeFi ecosystem

### For Lenders
- Verify borrower repayment history across chains
- Make informed lending decisions
- Reduce default risk with score-based assessment

### For Developers
- Build on Creditcoin with existing DeFi data
- Create new credit scoring algorithms
- Integrate cross-chain credit verification

---

## 🤝 Contributing

This is a hackathon project. We welcome feedback, bug reports, and suggestions!

---

## 📝 License

MIT License - see LICENSE file for details

---

## 🙏 Acknowledgments

- **Creditcoin**: The underlying blockchain platform
- **Attestcoin Protocol**: Proof verification infrastructure
- **Foundry**: Testing and deployment framework
- **RainbowKit**: Wallet connection experience

---

**Built for the Creditcoin Hackathon 2026**

*Making cross-chain credit reputation accessible to everyone.* 🌐💳
