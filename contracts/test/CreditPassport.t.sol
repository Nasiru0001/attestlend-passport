// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {CreditPassport} from "../creditcoin/CreditPassport.sol";
import {AttestcoinConsumer} from "../creditcoin/AttestcoinConsumer.sol";
import {INativeQueryVerifier} from "../creditcoin/VerifierInterface.sol";

contract CreditPassportVerifierMock is INativeQueryVerifier {
    uint256 public transactionIndex = 7;

    function verifyAndEmit(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        pure
        returns (bool verified)
    {
        return true;
    }

    function calculateTxIndex(MerkleProof calldata) external view returns (uint256) {
        return transactionIndex;
    }

    function setTransactionIndex(uint256 value) external {
        transactionIndex = value;
    }
}

/**
 * @title CreditPassportTest
 * @notice Verifies repayment decoding, score updates, and proof replay protection.
 */
contract CreditPassportTest is Test {
    bytes32 private constant LOAN_REPAID_TOPIC =
        keccak256("LoanRepaid(bytes32,address,address,address,uint256,uint256,uint256,bool)");

    CreditPassportVerifierMock private verifier;
    CreditPassport private passport;
    INativeQueryVerifier.MerkleProof private merkleProof;
    INativeQueryVerifier.ContinuityProof private continuityProof;
    address private loanBook = makeAddr("loanBook");
    address private borrower = makeAddr("borrower");
    address private lender = makeAddr("lender");
    address private token = makeAddr("token");
    bytes32 private loanId = keccak256("loan");

    function setUp() external {
        verifier = new CreditPassportVerifierMock();
        passport = new CreditPassport(address(verifier), loanBook);
    }

    function testInitialScoreIsFiveHundred() external view {
        assertEq(passport.getScore(borrower), 500);
    }

    function testPartialRepaymentsAddTenPointsEach() external {
        passport.execute(
            1, 100, _encodedRepayment(100 ether, 100 ether, 1_000 ether, false), merkleProof, continuityProof
        );
        verifier.setTransactionIndex(8);
        passport.execute(
            1, 100, _encodedRepayment(200 ether, 300 ether, 1_000 ether, false), merkleProof, continuityProof
        );

        assertEq(passport.getScore(borrower), 520);
        assertEq(passport.paymentCounts(borrower), 2);
    }

    function testFullRepaymentAddsPaymentAndCompletionPoints() external {
        passport.execute(
            1, 100, _encodedRepayment(1_000 ether, 1_000 ether, 1_000 ether, true), merkleProof, continuityProof
        );

        assertEq(passport.getScore(borrower), 560);
        assertEq(passport.paymentCounts(borrower), 1);
    }

    function testReplayIsRejectedBeforeSecondScoreUpdate() external {
        bytes memory repayment = _encodedRepayment(100 ether, 100 ether, 1_000 ether, false);
        passport.execute(1, 100, repayment, merkleProof, continuityProof);

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestcoinConsumer.QueryAlreadyProcessed.selector,
                keccak256(abi.encode(uint64(1), uint64(100), uint256(7)))
            )
        );
        passport.execute(1, 100, repayment, merkleProof, continuityProof);

        assertEq(passport.getScore(borrower), 510);
        assertEq(passport.paymentCounts(borrower), 1);
    }

    function testWrongEmitterIsRejected() external {
        bytes32[] memory topics = _topics();
        vm.expectRevert(abi.encodeWithSelector(CreditPassport.InvalidSourceContract.selector, address(this), loanBook));
        passport.execute(
            1, 100, abi.encode(address(this), topics, _data(100 ether, false)), merkleProof, continuityProof
        );
    }

    function _encodedRepayment(uint256 payment, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)
        private
        view
        returns (bytes memory)
    {
        return abi.encode(loanBook, _topics(), _data(payment, totalRepaid, amountDue, fullyRepaid));
    }

    function _topics() private view returns (bytes32[] memory topics) {
        topics = new bytes32[](4);
        topics[0] = LOAN_REPAID_TOPIC;
        topics[1] = loanId;
        topics[2] = bytes32(uint256(uint160(borrower)));
        topics[3] = bytes32(uint256(uint160(lender)));
    }

    function _data(uint256 payment, bool fullyRepaid) private view returns (bytes memory) {
        return _data(payment, payment, 1_000 ether, fullyRepaid);
    }

    function _data(uint256 payment, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid)
        private
        view
        returns (bytes memory)
    {
        return abi.encode(token, payment, totalRepaid, amountDue, fullyRepaid);
    }
}
