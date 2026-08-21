// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title INativeQueryVerifier
 * @notice Describes the Creditcoin precompile used to verify Attestcoin transaction inclusion proofs.
 * @dev The production precompile is exposed at address 0x0000000000000000000000000000000000000FD2.
 */
interface INativeQueryVerifier {
    /**
     * @notice Represents one sibling in a source transaction Merkle proof.
     * @param hash Sibling node hash used to reconstruct the Merkle root.
     * @param isLeft True when the sibling belongs on the left side of the current node.
     */
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    /**
     * @notice Contains the source transaction Merkle proof.
     * @param root Merkle root committed for the source block.
     * @param siblings Ordered sibling nodes from the transaction leaf to the root.
     */
    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    /**
     * @notice Contains the proof linking a source block to an attested Creditcoin endpoint.
     * @param lowerEndpointDigest Digest identifying the lower continuity endpoint.
     * @param roots Ordered continuity Merkle roots connecting the source block to an attestation.
     */
    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    /**
     * @notice Verifies a source transaction and emits the verifier's native proof event.
     * @param chainKey Creditcoin's internal identifier for the source chain.
     * @param blockHeight Source-chain block containing the transaction.
     * @param encodedTransaction ABI-encoded source transaction and receipt bytes.
     * @param merkleProof Proof that the transaction belongs to the source block.
     * @param continuityProof Proof that the source block is connected to an attested endpoint.
     * @return verified True when both proof components are valid.
     */
    function verifyAndEmit(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool verified);

    /**
     * @notice Calculates the source transaction index represented by a Merkle proof.
     * @param merkleProof Merkle proof whose sibling directions identify the transaction index.
     * @return transactionIndex Zero-based transaction index in the source block.
     */
    function calculateTxIndex(MerkleProof calldata merkleProof) external view returns (uint256 transactionIndex);
}

/**
 * @title NativeQueryVerifierLib
 * @notice Returns the typed interface for Creditcoin's native Attestcoin verifier precompile.
 */
library NativeQueryVerifierLib {
    /// @notice Address of Creditcoin's native transaction proof verifier precompile.
    address internal constant VERIFIER_ADDRESS = 0x0000000000000000000000000000000000000FD2;

    /**
     * @notice Returns the Creditcoin verifier precompile as its typed interface.
     * @return verifier Typed handle for calling the native verifier.
     */
    function getVerifier() internal pure returns (INativeQueryVerifier verifier) {
        return INativeQueryVerifier(VERIFIER_ADDRESS);
    }
}
