// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {AttestcoinConsumer} from "../creditcoin/AttestcoinConsumer.sol";
import {INativeQueryVerifier} from "../creditcoin/VerifierInterface.sol";

/**
 * @title MockVerifier
 * @notice Provides deterministic verifier behavior for local Attestcoin consumer tests.
 */
contract MockVerifier is INativeQueryVerifier {
    bool public shouldVerify = true;
    uint256 public transactionIndex = 7;

    /**
     * @notice Configures whether future proof verification calls succeed.
     * @param value True to accept proofs, or false to reject them.
     */
    function setShouldVerify(bool value) external {
        shouldVerify = value;
    }

    /**
     * @notice Configures the transaction index returned for replay-protection tests.
     * @param value Source transaction index to return.
     */
    function setTransactionIndex(uint256 value) external {
        transactionIndex = value;
    }

    /**
     * @notice Returns the configured proof-verification result.
     * @param chainKey Unused source-chain identifier.
     * @param blockHeight Unused source block height.
     * @param encodedTransaction Unused encoded transaction.
     * @param merkleProof Unused transaction Merkle proof.
     * @param continuityProof Unused continuity proof.
     * @return verified Configured mock verification result.
     */
    function verifyAndEmit(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool verified) {
        chainKey;
        blockHeight;
        encodedTransaction;
        merkleProof;
        continuityProof;
        return shouldVerify;
    }

    /**
     * @notice Returns the configured transaction index.
     * @param merkleProof Unused proof input.
     * @return index Configured source transaction index.
     */
    function calculateTxIndex(MerkleProof calldata merkleProof) external view returns (uint256 index) {
        merkleProof;
        return transactionIndex;
    }
}

/**
 * @title TestConsumer
 * @notice Exposes a minimal application hook for testing the shared consumer behavior.
 */
contract TestConsumer is AttestcoinConsumer {
    bytes32 public lastQueryId;
    bytes public lastTransaction;
    uint256 public processCount;

    /**
     * @notice Connects the test consumer to a verifier mock.
     * @param mockVerifier Address of the verifier mock.
     */
    constructor(address mockVerifier) AttestcoinConsumer(mockVerifier) {}

    /**
     * @notice Processes and records the transaction accepted by the verifier.
     * @param queryId Unique identifier assigned to the proven transaction.
     * @param encodedTransaction Encoded transaction accepted by the verifier.
     */
    function _processVerifiedTransaction(bytes32 queryId, bytes calldata encodedTransaction) internal override {
        lastQueryId = queryId;
        lastTransaction = encodedTransaction;
        processCount += 1;
    }
}

/**
 * @title AttestcoinConsumerTest
 * @notice Verifies proof acceptance, rejection, dispatch, and replay protection.
 */
contract AttestcoinConsumerTest is Test {
    MockVerifier private mockVerifier;
    TestConsumer private consumer;
    INativeQueryVerifier.MerkleProof private merkleProof;
    INativeQueryVerifier.ContinuityProof private continuityProof;

    /**
     * @notice Deploys the mock verifier and test consumer, then points the immutable verifier slot at the mock.
     */
    function setUp() external {
        mockVerifier = new MockVerifier();
        consumer = new TestConsumer(address(mockVerifier));
    }

    /**
     * @notice Confirms a valid proof is dispatched once and marked as processed.
     */
    function testExecuteAcceptsAndDispatchesProof() external {
        bytes memory encodedTransaction = hex"1234";

        bytes32 queryId = consumer.execute(1, 100, encodedTransaction, merkleProof, continuityProof);

        assertEq(queryId, keccak256(abi.encode(uint64(1), uint64(100), uint256(7))));
        assertTrue(consumer.processedQueries(queryId));
        assertEq(consumer.processCount(), 1);
        assertEq(consumer.lastQueryId(), queryId);
        assertEq(consumer.lastTransaction(), encodedTransaction);
    }

    /**
     * @notice Confirms a verifier rejection prevents application processing.
     */
    function testExecuteRevertsWhenProofIsInvalid() external {
        mockVerifier.setShouldVerify(false);

        vm.expectRevert(AttestcoinConsumer.ProofVerificationFailed.selector);
        consumer.execute(1, 100, hex"1234", merkleProof, continuityProof);

        assertEq(consumer.processCount(), 0);
    }

    /**
     * @notice Confirms a source proof cannot be submitted twice for the same block and transaction index.
     */
    function testExecuteRevertsOnReplay() external {
        consumer.execute(1, 100, hex"1234", merkleProof, continuityProof);

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestcoinConsumer.QueryAlreadyProcessed.selector,
                keccak256(abi.encode(uint64(1), uint64(100), uint256(7)))
            )
        );
        consumer.execute(1, 100, hex"5678", merkleProof, continuityProof);
    }

    /**
     * @notice Confirms different source transaction indexes produce independent replay identifiers.
     */
    function testDifferentTransactionIndexCanBeProcessed() external {
        consumer.execute(1, 100, hex"1234", merkleProof, continuityProof);
        mockVerifier.setTransactionIndex(8);
        consumer.execute(1, 100, hex"5678", merkleProof, continuityProof);

        assertEq(consumer.processCount(), 2);
    }
}
