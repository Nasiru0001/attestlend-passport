// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {INativeQueryVerifier} from "./VerifierInterface.sol";

/**
 * @title AttestcoinConsumer
 * @notice Provides the shared proof-verification and replay-protection flow for Creditcoin application contracts.
 * @dev Child contracts implement `_processVerifiedTransaction` to interpret a proven source-chain transaction.
 */
abstract contract AttestcoinConsumer {
    /// @notice The native Creditcoin precompile used to verify Attestcoin proofs.
    INativeQueryVerifier public immutable verifier;

    /// @notice Tracks source proofs that have already been accepted by this consumer.
    /// @dev The key includes source chain, block height, and transaction index.
    mapping(bytes32 queryId => bool processed) public processedQueries;

    /// @notice Reverts when a source proof has already been consumed.
    /// @param queryId Unique identifier of the source transaction proof.
    error QueryAlreadyProcessed(bytes32 queryId);

    /// @notice Reverts when the native verifier rejects the supplied proof.
    error ProofVerificationFailed();

    /// @notice Emitted after the native verifier accepts a proof and before application processing completes.
    /// @param queryId Unique identifier assigned to the proven source transaction.
    /// @param chainKey Creditcoin's internal source-chain identifier.
    /// @param blockHeight Source-chain block containing the proven transaction.
    event AttestcoinProofAccepted(bytes32 indexed queryId, uint64 indexed chainKey, uint64 indexed blockHeight);

    /**
     * @notice Connects this consumer to a Creditcoin-compatible Attestcoin verifier.
     * @dev Production contracts should pass `NativeQueryVerifierLib.getVerifier()`; tests may pass a mock verifier.
     * @param verifierAddress Address of the verifier precompile or compatible test double.
     */
    constructor(address verifierAddress) {
        verifier = INativeQueryVerifier(verifierAddress);
    }

    /**
     * @notice Verifies a source transaction proof and dispatches the proven transaction to application logic.
     * @param chainKey Creditcoin's internal identifier for the source chain.
     * @param blockHeight Source-chain block containing the transaction.
     * @param encodedTransaction ABI-encoded source transaction and receipt bytes.
     * @param merkleProof Proof that the transaction belongs to the source block.
     * @param continuityProof Proof connecting the source block to an attested endpoint.
     * @return queryId Unique identifier recorded for replay protection.
     */
    function execute(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external returns (bytes32 queryId) {
        uint256 transactionIndex = verifier.calculateTxIndex(merkleProof);
        queryId = keccak256(abi.encode(chainKey, blockHeight, transactionIndex));

        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);

        bool verified = verifier.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        if (!verified) revert ProofVerificationFailed();

        processedQueries[queryId] = true;
        emit AttestcoinProofAccepted(queryId, chainKey, blockHeight);

        _processVerifiedTransaction(queryId, encodedTransaction);
    }

    /**
     * @notice Processes a transaction after the native verifier has accepted its proof.
     * @param queryId Unique identifier assigned to the proven source transaction.
     * @param encodedTransaction ABI-encoded source transaction and receipt bytes.
     */
    function _processVerifiedTransaction(bytes32 queryId, bytes calldata encodedTransaction) internal virtual;
}
