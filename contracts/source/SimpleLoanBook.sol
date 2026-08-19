// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IERC20LoanAsset
 * @notice Defines the ERC20 operations required by the source-chain loan contract.
 */
interface IERC20LoanAsset {
    /**
     * @notice Returns the token balance held by an account.
     * @param account Address whose token balance should be read.
     * @return balance The account's token balance in base units.
     */
    function balanceOf(address account) external view returns (uint256 balance);

    /**
     * @notice Transfers tokens using allowance granted to the caller.
     * @param from Address that owns the tokens.
     * @param to Address that will receive the tokens.
     * @param amount Number of token base units to transfer.
     * @return success True when the token reports a successful transfer.
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool success);
}

/**
 * @title SimpleLoanBook
 * @notice Manages fixed bilateral loans on a source chain and emits repayment facts for Attestcoin proofs.
 * @dev The contract intentionally avoids collateral, price feeds, and liquidation logic so the demo focuses on cross-chain repayment verification.
 */
contract SimpleLoanBook {
    /// @notice Describes the lifecycle state of a loan.
    enum LoanStatus {
        Created,
        Funded,
        Repaid,
        Cancelled
    }

    /// @notice Stores the complete source-chain state for one fixed loan agreement.
    /// @param lender Account that creates and funds the loan.
    /// @param borrower Account that receives principal and makes repayments.
    /// @param token ERC20-compatible asset used for funding and repayment.
    /// @param principal Amount transferred to the borrower when the loan is funded.
    /// @param amountDue Total principal and interest the borrower must repay.
    /// @param amountRepaid Amount successfully repaid so far.
    /// @param repaymentDeadline Timestamp after which new repayments are rejected.
    /// @param status Current loan lifecycle state.
    struct Loan {
        address lender;
        address borrower;
        address token;
        uint256 principal;
        uint256 amountDue;
        uint256 amountRepaid;
        uint64 repaymentDeadline;
        LoanStatus status;
    }

    /// @notice Reverts when a required address is the zero address.
    error ZeroAddress();

    /// @notice Reverts when an amount required to be positive is zero.
    error ZeroAmount();

    /// @notice Reverts when total repayment is less than the principal being lent.
    /// @param principal Principal amount proposed by the lender.
    /// @param amountDue Total repayment amount proposed by the lender.
    error InvalidAmountDue(uint256 principal, uint256 amountDue);

    /// @notice Reverts when a repayment deadline is not in the future.
    /// @param deadline Invalid deadline supplied by the caller.
    /// @param currentTime Current block timestamp used for validation.
    error InvalidDeadline(uint256 deadline, uint256 currentTime);

    /// @notice Reverts when a requested loan identifier does not exist.
    /// @param loanId Unknown loan identifier.
    error LoanNotFound(bytes32 loanId);

    /// @notice Reverts when a caller does not hold the role required by an operation.
    /// @param caller Address that attempted the operation.
    /// @param expected Address authorized to perform the operation.
    error Unauthorized(address caller, address expected);

    /// @notice Reverts when a loan is not in the state required by an operation.
    /// @param actual Current loan status.
    /// @param expected Status required by the operation.
    error InvalidLoanStatus(LoanStatus actual, LoanStatus expected);

    /// @notice Reverts when a repayment is attempted after the agreed deadline.
    /// @param deadline Loan repayment deadline.
    /// @param currentTime Current block timestamp.
    error LoanExpired(uint256 deadline, uint256 currentTime);

    /// @notice Reverts when a repayment exceeds the remaining amount due.
    /// @param attempted Repayment amount supplied by the borrower.
    /// @param remaining Maximum repayment still accepted by the loan.
    error RepaymentExceedsRemaining(uint256 attempted, uint256 remaining);

    /// @notice Reverts when an ERC20 operation returns false.
    error TokenTransferFailed();

    /// @notice Reverts when transfer fees or unusual token mechanics change the expected received amount.
    /// @param expected Token amount that should have been received.
    /// @param received Actual balance increase observed after transfer.
    error UnsupportedTokenBehavior(uint256 expected, uint256 received);

    /// @notice Emitted when a lender creates a new loan offer.
    /// @param loanId Deterministic identifier assigned to the loan.
    /// @param lender Account offering and funding the loan.
    /// @param borrower Account designated to receive and repay the loan.
    /// @param token ERC20-compatible token used for the loan.
    /// @param principal Amount the borrower may receive.
    /// @param amountDue Total amount the borrower must repay.
    /// @param repaymentDeadline Timestamp after which repayments are rejected.
    event LoanCreated(
        bytes32 indexed loanId,
        address indexed lender,
        address indexed borrower,
        address token,
        uint256 principal,
        uint256 amountDue,
        uint64 repaymentDeadline
    );

    /// @notice Emitted when the lender transfers the principal to the borrower.
    /// @param loanId Identifier of the funded loan.
    /// @param lender Account that supplied the principal.
    /// @param borrower Account that received the principal.
    /// @param token ERC20-compatible token transferred to the borrower.
    /// @param principal Number of token base units transferred.
    event LoanFunded(
        bytes32 indexed loanId, address indexed lender, address indexed borrower, address token, uint256 principal
    );

    /// @notice Emitted after each successful repayment and designed to be proven to Creditcoin through Attestcoin.
    /// @param loanId Identifier of the repaid loan.
    /// @param borrower Account that made the repayment.
    /// @param lender Account that received the repayment.
    /// @param token ERC20-compatible token used for repayment.
    /// @param paymentAmount Amount transferred in this transaction.
    /// @param totalRepaid Cumulative amount repaid after this transaction.
    /// @param amountDue Total amount required to complete the loan.
    /// @param fullyRepaid True when this payment completed the loan.
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

    /// @notice Emitted when a lender cancels an unfunded loan offer.
    /// @param loanId Identifier of the cancelled loan.
    /// @param lender Account that cancelled the offer.
    event LoanCancelled(bytes32 indexed loanId, address indexed lender);

    uint256 private _nextLoanNonce;
    mapping(bytes32 loanId => Loan loan) private _loans;

    /**
     * @notice Creates an unfunded fixed-term loan offer for a specific borrower.
     * @param borrower Account that may receive the principal and must make repayments.
     * @param token ERC20-compatible asset used to fund and repay the loan.
     * @param principal Number of token base units the lender will provide.
     * @param amountDue Total number of token base units required for full repayment.
     * @param repaymentDeadline Future timestamp by which repayments must be completed.
     * @return loanId Deterministic identifier of the newly created loan.
     */
    function createLoan(address borrower, address token, uint256 principal, uint256 amountDue, uint64 repaymentDeadline)
        external
        returns (bytes32 loanId)
    {
        if (borrower == address(0) || token == address(0)) revert ZeroAddress();
        if (principal == 0) revert ZeroAmount();
        if (amountDue < principal) revert InvalidAmountDue(principal, amountDue);
        if (repaymentDeadline <= block.timestamp) {
            revert InvalidDeadline(repaymentDeadline, block.timestamp);
        }

        uint256 nonce = _nextLoanNonce++;
        loanId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                msg.sender,
                borrower,
                token,
                principal,
                amountDue,
                repaymentDeadline,
                nonce
            )
        );

        _loans[loanId] = Loan({
            lender: msg.sender,
            borrower: borrower,
            token: token,
            principal: principal,
            amountDue: amountDue,
            amountRepaid: 0,
            repaymentDeadline: repaymentDeadline,
            status: LoanStatus.Created
        });

        emit LoanCreated(loanId, msg.sender, borrower, token, principal, amountDue, repaymentDeadline);
    }

    /**
     * @notice Funds a created loan by transferring its principal directly from lender to borrower.
     * @dev The lender must approve this contract for at least the principal before calling.
     * @param loanId Identifier of the loan to fund.
     */
    function fundLoan(bytes32 loanId) external {
        Loan storage loan = _getExistingLoan(loanId);
        if (msg.sender != loan.lender) revert Unauthorized(msg.sender, loan.lender);
        if (loan.status != LoanStatus.Created) revert InvalidLoanStatus(loan.status, LoanStatus.Created);

        loan.status = LoanStatus.Funded;
        _transferExact(loan.token, loan.lender, loan.borrower, loan.principal);

        emit LoanFunded(loanId, loan.lender, loan.borrower, loan.token, loan.principal);
    }

    /**
     * @notice Repays part or all of a funded loan and emits a proof-friendly repayment event.
     * @dev The borrower must approve this contract for at least the payment amount before calling.
     * @param loanId Identifier of the loan being repaid.
     * @param paymentAmount Number of token base units to transfer to the lender.
     * @return fullyRepaid True when the payment satisfies the complete outstanding balance.
     */
    function repayLoan(bytes32 loanId, uint256 paymentAmount) external returns (bool fullyRepaid) {
        Loan storage loan = _getExistingLoan(loanId);
        if (msg.sender != loan.borrower) revert Unauthorized(msg.sender, loan.borrower);
        if (loan.status != LoanStatus.Funded) revert InvalidLoanStatus(loan.status, LoanStatus.Funded);
        if (block.timestamp > loan.repaymentDeadline) {
            revert LoanExpired(loan.repaymentDeadline, block.timestamp);
        }
        if (paymentAmount == 0) revert ZeroAmount();

        uint256 remaining = loan.amountDue - loan.amountRepaid;
        if (paymentAmount > remaining) revert RepaymentExceedsRemaining(paymentAmount, remaining);

        loan.amountRepaid += paymentAmount;
        fullyRepaid = loan.amountRepaid == loan.amountDue;
        if (fullyRepaid) loan.status = LoanStatus.Repaid;

        _transferExact(loan.token, loan.borrower, loan.lender, paymentAmount);

        emit LoanRepaid(
            loanId,
            loan.borrower,
            loan.lender,
            loan.token,
            paymentAmount,
            loan.amountRepaid,
            loan.amountDue,
            fullyRepaid
        );
    }

    /**
     * @notice Cancels a loan offer before its principal has been funded.
     * @param loanId Identifier of the loan to cancel.
     */
    function cancelLoan(bytes32 loanId) external {
        Loan storage loan = _getExistingLoan(loanId);
        if (msg.sender != loan.lender) revert Unauthorized(msg.sender, loan.lender);
        if (loan.status != LoanStatus.Created) revert InvalidLoanStatus(loan.status, LoanStatus.Created);

        loan.status = LoanStatus.Cancelled;
        emit LoanCancelled(loanId, loan.lender);
    }

    /**
     * @notice Returns all stored terms and repayment state for an existing loan.
     * @param loanId Identifier of the loan to inspect.
     * @return loan Complete stored loan record.
     */
    function getLoan(bytes32 loanId) external view returns (Loan memory loan) {
        loan = _getExistingLoan(loanId);
    }

    /**
     * @notice Returns the unpaid amount remaining on an existing loan.
     * @param loanId Identifier of the loan to inspect.
     * @return remaining Number of token base units still owed.
     */
    function remainingAmount(bytes32 loanId) external view returns (uint256 remaining) {
        Loan storage loan = _getExistingLoan(loanId);
        return loan.amountDue - loan.amountRepaid;
    }

    /**
     * @notice Loads an existing loan or reverts when the identifier is unknown.
     * @param loanId Identifier of the loan to load.
     * @return loan Storage reference containing the requested loan.
     */
    function _getExistingLoan(bytes32 loanId) private view returns (Loan storage loan) {
        loan = _loans[loanId];
        if (loan.lender == address(0)) revert LoanNotFound(loanId);
    }

    /**
     * @notice Transfers an exact token amount and rejects fee-on-transfer or otherwise incompatible assets.
     * @param token ERC20-compatible token to transfer.
     * @param from Account supplying the tokens.
     * @param to Account receiving the tokens.
     * @param amount Number of token base units expected to arrive.
     */
    function _transferExact(address token, address from, address to, uint256 amount) private {
        IERC20LoanAsset asset = IERC20LoanAsset(token);
        uint256 balanceBefore = asset.balanceOf(to);
        if (!asset.transferFrom(from, to, amount)) revert TokenTransferFailed();

        uint256 received = asset.balanceOf(to) - balanceBefore;
        if (received != amount) revert UnsupportedTokenBehavior(amount, received);
    }
}
