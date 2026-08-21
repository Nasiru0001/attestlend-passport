// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AttestcoinConsumer} from "./AttestcoinConsumer.sol";

/**
 * @title CreditPassport
 * @notice Records borrower credit scores from verified SimpleLoanBook repayments.
 * @dev The verifier authenticates the source transaction. This contract then
 *      authenticates the repayment log encoded for application processing.
 */
contract CreditPassport is AttestcoinConsumer {
    /// @notice The score assigned to a borrower before any repayment is recorded.
    uint256 public constant INITIAL_SCORE = 500;

    /// @notice Score points awarded for each successful repayment payment.
    uint256 public constant PAYMENT_SCORE_INCREMENT = 10;

    /// @notice Additional score points awarded when a loan is fully repaid.
    uint256 public constant FULL_REPAYMENT_SCORE_INCREMENT = 50;

    /// @notice The source-chain loan contract whose logs are accepted.
    address public immutable loanBook;

    /// @notice Credit score for each borrower with a recorded repayment.
    mapping(address borrower => uint256 score) public scores;

    /// @notice Number of repayment payments recorded for each borrower.
    mapping(address borrower => uint256 paymentCount) public paymentCounts;

    /// @notice Reverts when a repayment log is not emitted by the configured loan book.
    error InvalidSourceContract(address actual, address expected);

    /// @notice Reverts when the supplied log is not a SimpleLoanBook LoanRepaid event.
    error InvalidLoanRepaidEvent();

    /// @notice Emitted after a verified repayment updates a borrower's score.
    /// @param queryId Unique source transaction proof identifier.
    /// @param borrower Borrower whose score changed.
    /// @param loanId Repaid loan identifier.
    /// @param paymentAmount Amount paid in this repayment.
    /// @param fullyRepaid Whether this payment completed the loan.
    /// @param newScore Borrower's score after applying the update.
    event CreditScoreUpdated(
        bytes32 indexed queryId,
        address indexed borrower,
        bytes32 indexed loanId,
        uint256 paymentAmount,
        bool fullyRepaid,
        uint256 newScore
    );

    /// @dev Topic zero for SimpleLoanBook.LoanRepaid(bytes32,address,address,address,uint256,uint256,uint256,bool).
    bytes32 private constant LOAN_REPAID_TOPIC =
        keccak256("LoanRepaid(bytes32,address,address,address,uint256,uint256,uint256,bool)");

    /**
     * @notice Connects the passport to an Attestcoin verifier and source loan book.
     * @param verifierAddress Attestcoin verifier or compatible test double.
     * @param loanBookAddress Source-chain SimpleLoanBook address.
     */
    constructor(address verifierAddress, address loanBookAddress) AttestcoinConsumer(verifierAddress) {
        loanBook = loanBookAddress;
    }

    /**
     * @notice Returns a borrower's current score, including the initial score.
     * @param borrower Account whose score should be read.
     * @return score Borrower's current credit score.
     */
    function getScore(address borrower) external view returns (uint256 score) {
        score = scores[borrower];
        if (score == 0) score = INITIAL_SCORE;
    }

    /**
     * @notice Decodes and applies a verified SimpleLoanBook repayment log.
     * @dev The payload must be abi.encode(sourceContract, topics, data), where
     *      topics and data are the EVM receipt log fields. Topics one through
     *      three contain loanId, borrower, and lender. Data contains token,
     *      paymentAmount, totalRepaid, amountDue, and fullyRepaid.
     * @param queryId Unique source transaction proof identifier.
     * @param encodedTransaction ABI-encoded repayment log fields.
     */
    function _processVerifiedTransaction(bytes32 queryId, bytes calldata encodedTransaction) internal override {
        (address sourceContract, bytes32[] memory topics, bytes memory data) =
            abi.decode(encodedTransaction, (address, bytes32[], bytes));

        if (sourceContract != loanBook) revert InvalidSourceContract(sourceContract, loanBook);
        if (topics.length != 4 || topics[0] != LOAN_REPAID_TOPIC) revert InvalidLoanRepaidEvent();

        address borrower = address(uint160(uint256(topics[2])));
        (address token, uint256 paymentAmount, uint256 totalRepaid, uint256 amountDue, bool fullyRepaid) =
            abi.decode(data, (address, uint256, uint256, uint256, bool));
        token;
        totalRepaid;
        amountDue;

        uint256 currentScore = scores[borrower];
        if (currentScore == 0) currentScore = INITIAL_SCORE;
        uint256 newScore = currentScore + PAYMENT_SCORE_INCREMENT;
        if (fullyRepaid) newScore += FULL_REPAYMENT_SCORE_INCREMENT;

        scores[borrower] = newScore;
        paymentCounts[borrower] += 1;
        emit CreditScoreUpdated(queryId, borrower, topics[1], paymentAmount, fullyRepaid, newScore);
    }
}
