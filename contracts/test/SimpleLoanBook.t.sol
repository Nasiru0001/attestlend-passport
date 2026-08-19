// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {SimpleLoanBook} from "../source/SimpleLoanBook.sol";
import {TestToken} from "../source/TestToken.sol";

/**
 * @title SimpleLoanBookTest
 * @notice Verifies the complete source-chain loan lifecycle and the repayment event later consumed by Creditcoin.
 */
contract SimpleLoanBookTest is Test {
    event LoanRepaid(
        bytes32 indexed loanId,
        address indexed borrower,
        address indexed lender,
        address token,
        uint256 paymentAmount,
        uint256 totalRepaid,
        uint256 amountDue,
        bool fullyRepaid
    );

    uint256 private constant PRINCIPAL = 1_000 ether;
    uint256 private constant AMOUNT_DUE = 1_050 ether;

    SimpleLoanBook private loanBook;
    TestToken private token;
    address private lender = makeAddr("lender");
    address private borrower = makeAddr("borrower");
    address private stranger = makeAddr("stranger");
    uint64 private deadline;

    /**
     * @notice Deploys fresh contracts, funds both participants, and grants loan-book allowances before each test.
     */
    function setUp() external {
        loanBook = new SimpleLoanBook();
        token = new TestToken();
        deadline = uint64(block.timestamp + 30 days);

        token.faucet(lender, PRINCIPAL);
        token.faucet(borrower, AMOUNT_DUE);

        vm.prank(lender);
        token.approve(address(loanBook), type(uint256).max);

        vm.prank(borrower);
        token.approve(address(loanBook), type(uint256).max);
    }

    /**
     * @notice Confirms loan creation stores all terms and starts in the Created state.
     */
    function testCreateLoanStoresTerms() external {
        bytes32 loanId = _createLoan();
        SimpleLoanBook.Loan memory loan = loanBook.getLoan(loanId);

        assertEq(loan.lender, lender);
        assertEq(loan.borrower, borrower);
        assertEq(loan.token, address(token));
        assertEq(loan.principal, PRINCIPAL);
        assertEq(loan.amountDue, AMOUNT_DUE);
        assertEq(loan.amountRepaid, 0);
        assertEq(loan.repaymentDeadline, deadline);
        assertEq(uint8(loan.status), uint8(SimpleLoanBook.LoanStatus.Created));
        assertEq(loanBook.remainingAmount(loanId), AMOUNT_DUE);
    }

    /**
     * @notice Confirms funding transfers principal directly to the borrower and advances loan state.
     */
    function testFundLoanTransfersPrincipal() external {
        bytes32 loanId = _createLoan();

        vm.prank(lender);
        loanBook.fundLoan(loanId);

        SimpleLoanBook.Loan memory loan = loanBook.getLoan(loanId);
        assertEq(uint8(loan.status), uint8(SimpleLoanBook.LoanStatus.Funded));
        assertEq(token.balanceOf(lender), 0);
        assertEq(token.balanceOf(borrower), AMOUNT_DUE + PRINCIPAL);
    }

    /**
     * @notice Confirms partial repayment transfers tokens, updates totals, and emits a non-final repayment fact.
     */
    function testPartialRepaymentEmitsProofFriendlyEvent() external {
        bytes32 loanId = _createAndFundLoan();
        uint256 payment = 400 ether;

        vm.expectEmit(true, true, true, true, address(loanBook));
        emit LoanRepaid(loanId, borrower, lender, address(token), payment, payment, AMOUNT_DUE, false);

        vm.prank(borrower);
        bool fullyRepaid = loanBook.repayLoan(loanId, payment);

        SimpleLoanBook.Loan memory loan = loanBook.getLoan(loanId);
        assertFalse(fullyRepaid);
        assertEq(loan.amountRepaid, payment);
        assertEq(loanBook.remainingAmount(loanId), AMOUNT_DUE - payment);
        assertEq(uint8(loan.status), uint8(SimpleLoanBook.LoanStatus.Funded));
        assertEq(token.balanceOf(lender), payment);
    }

    /**
     * @notice Confirms the final repayment closes the loan and emits cumulative repayment totals.
     */
    function testFullRepaymentClosesLoan() external {
        bytes32 loanId = _createAndFundLoan();

        vm.prank(borrower);
        loanBook.repayLoan(loanId, 400 ether);

        vm.expectEmit(true, true, true, true, address(loanBook));
        emit LoanRepaid(loanId, borrower, lender, address(token), 650 ether, AMOUNT_DUE, AMOUNT_DUE, true);

        vm.prank(borrower);
        bool fullyRepaid = loanBook.repayLoan(loanId, 650 ether);

        SimpleLoanBook.Loan memory loan = loanBook.getLoan(loanId);
        assertTrue(fullyRepaid);
        assertEq(loan.amountRepaid, AMOUNT_DUE);
        assertEq(loanBook.remainingAmount(loanId), 0);
        assertEq(uint8(loan.status), uint8(SimpleLoanBook.LoanStatus.Repaid));
        assertEq(token.balanceOf(lender), AMOUNT_DUE);
    }

    /**
     * @notice Confirms only the lender can fund a created loan.
     */
    function testFundLoanRevertsForUnauthorizedCaller() external {
        bytes32 loanId = _createLoan();

        vm.expectRevert(abi.encodeWithSelector(SimpleLoanBook.Unauthorized.selector, stranger, lender));
        vm.prank(stranger);
        loanBook.fundLoan(loanId);
    }

    /**
     * @notice Confirms only the designated borrower can make repayments.
     */
    function testRepayLoanRevertsForUnauthorizedCaller() external {
        bytes32 loanId = _createAndFundLoan();

        vm.expectRevert(abi.encodeWithSelector(SimpleLoanBook.Unauthorized.selector, stranger, borrower));
        vm.prank(stranger);
        loanBook.repayLoan(loanId, 1 ether);
    }

    /**
     * @notice Confirms repayments larger than the outstanding balance are rejected.
     */
    function testRepayLoanRevertsForOverpayment() external {
        bytes32 loanId = _createAndFundLoan();

        vm.expectRevert(
            abi.encodeWithSelector(SimpleLoanBook.RepaymentExceedsRemaining.selector, AMOUNT_DUE + 1, AMOUNT_DUE)
        );
        vm.prank(borrower);
        loanBook.repayLoan(loanId, AMOUNT_DUE + 1);
    }

    /**
     * @notice Confirms repayments after the agreed deadline are rejected.
     */
    function testRepayLoanRevertsAfterDeadline() external {
        bytes32 loanId = _createAndFundLoan();
        vm.warp(uint256(deadline) + 1);

        vm.expectRevert(
            abi.encodeWithSelector(SimpleLoanBook.LoanExpired.selector, uint256(deadline), uint256(deadline) + 1)
        );
        vm.prank(borrower);
        loanBook.repayLoan(loanId, 1 ether);
    }

    /**
     * @notice Confirms the lender can cancel an unfunded offer and cannot fund it afterward.
     */
    function testCancelLoanClosesUnfundedOffer() external {
        bytes32 loanId = _createLoan();

        vm.prank(lender);
        loanBook.cancelLoan(loanId);

        SimpleLoanBook.Loan memory loan = loanBook.getLoan(loanId);
        assertEq(uint8(loan.status), uint8(SimpleLoanBook.LoanStatus.Cancelled));

        vm.expectRevert(
            abi.encodeWithSelector(
                SimpleLoanBook.InvalidLoanStatus.selector,
                SimpleLoanBook.LoanStatus.Cancelled,
                SimpleLoanBook.LoanStatus.Created
            )
        );
        vm.prank(lender);
        loanBook.fundLoan(loanId);
    }

    /**
     * @notice Creates a standard test loan using the lender account.
     * @return loanId Identifier assigned by the loan book.
     */
    function _createLoan() private returns (bytes32 loanId) {
        vm.prank(lender);
        return loanBook.createLoan(borrower, address(token), PRINCIPAL, AMOUNT_DUE, deadline);
    }

    /**
     * @notice Creates and funds a standard test loan for repayment tests.
     * @return loanId Identifier of the funded loan.
     */
    function _createAndFundLoan() private returns (bytes32 loanId) {
        loanId = _createLoan();
        vm.prank(lender);
        loanBook.fundLoan(loanId);
    }
}
