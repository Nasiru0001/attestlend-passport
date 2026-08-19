// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title TestToken
 * @notice Provides a small ERC20-compatible token for exercising the AttestLend loan flow on testnets.
 * @dev The faucet is intentionally permissionless because this token has no monetary value and exists only for demos.
 */
contract TestToken {
    /// @notice Reverts when an operation uses the zero address where a real account is required.
    error ZeroAddress();

    /// @notice Reverts when an account does not own enough tokens for a transfer.
    /// @param account Account whose balance was insufficient.
    /// @param available Current token balance of the account.
    /// @param required Token amount required by the operation.
    error InsufficientBalance(address account, uint256 available, uint256 required);

    /// @notice Reverts when a spender does not have enough allowance to transfer an owner's tokens.
    /// @param owner Account that owns the tokens.
    /// @param spender Account attempting the delegated transfer.
    /// @param available Current allowance granted to the spender.
    /// @param required Allowance required by the operation.
    error InsufficientAllowance(address owner, address spender, uint256 available, uint256 required);

    /// @notice Emitted whenever tokens move between accounts, including minting from the zero address.
    /// @param from Account tokens were taken from, or the zero address for a mint.
    /// @param to Account receiving the tokens.
    /// @param value Number of token base units transferred.
    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @notice Emitted whenever an owner changes a spender's allowance.
    /// @param owner Account that owns the approved tokens.
    /// @param spender Account permitted to transfer the owner's tokens.
    /// @param value New allowance in token base units.
    event Approval(address indexed owner, address indexed spender, uint256 value);

    string private constant TOKEN_NAME = "AttestLend Test USD";
    string private constant TOKEN_SYMBOL = "atUSD";
    uint8 private constant TOKEN_DECIMALS = 18;

    uint256 private _totalSupply;
    mapping(address account => uint256 balance) private _balances;
    mapping(address owner => mapping(address spender => uint256 amount)) private _allowances;

    /**
     * @notice Returns the human-readable token name.
     * @return tokenName The name displayed by wallets and explorers.
     */
    function name() external pure returns (string memory tokenName) {
        return TOKEN_NAME;
    }

    /**
     * @notice Returns the short token symbol.
     * @return tokenSymbol The symbol displayed by wallets and explorers.
     */
    function symbol() external pure returns (string memory tokenSymbol) {
        return TOKEN_SYMBOL;
    }

    /**
     * @notice Returns the number of decimal places used to display token amounts.
     * @return decimalPlaces The fixed number of token decimal places.
     */
    function decimals() external pure returns (uint8 decimalPlaces) {
        return TOKEN_DECIMALS;
    }

    /**
     * @notice Returns the total number of token base units currently minted.
     * @return supply The current total token supply.
     */
    function totalSupply() external view returns (uint256 supply) {
        return _totalSupply;
    }

    /**
     * @notice Returns the token balance held by an account.
     * @param account Address whose balance should be read.
     * @return balance The account's token balance in base units.
     */
    function balanceOf(address account) external view returns (uint256 balance) {
        return _balances[account];
    }

    /**
     * @notice Returns the amount a spender may transfer for a token owner.
     * @param owner Address that owns the approved tokens.
     * @param spender Address permitted to spend the owner's tokens.
     * @return amount The remaining allowance in token base units.
     */
    function allowance(address owner, address spender) external view returns (uint256 amount) {
        return _allowances[owner][spender];
    }

    /**
     * @notice Mints test tokens to a chosen account through the permissionless faucet.
     * @param to Address that will receive the newly minted tokens.
     * @param amount Number of token base units to mint.
     * @return success True when the mint completes.
     */
    function faucet(address to, uint256 amount) external returns (bool success) {
        if (to == address(0)) revert ZeroAddress();

        _totalSupply += amount;
        _balances[to] += amount;

        emit Transfer(address(0), to, amount);
        return true;
    }

    /**
     * @notice Transfers the caller's tokens to another account.
     * @param to Address that will receive the tokens.
     * @param amount Number of token base units to transfer.
     * @return success True when the transfer completes.
     */
    function transfer(address to, uint256 amount) external returns (bool success) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @notice Sets the exact amount a spender may transfer for the caller.
     * @param spender Address receiving permission to spend tokens.
     * @param amount New allowance in token base units.
     * @return success True when the allowance is stored.
     */
    function approve(address spender, uint256 amount) external returns (bool success) {
        if (spender == address(0)) revert ZeroAddress();

        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfers tokens from an owner using allowance previously granted to the caller.
     * @dev An allowance set to the maximum uint256 value is treated as unlimited and is not reduced.
     * @param from Address that owns the tokens.
     * @param to Address that will receive the tokens.
     * @param amount Number of token base units to transfer.
     * @return success True when the delegated transfer completes.
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool success) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance < amount) {
            revert InsufficientAllowance(from, msg.sender, currentAllowance, amount);
        }

        if (currentAllowance != type(uint256).max) {
            unchecked {
                _allowances[from][msg.sender] = currentAllowance - amount;
            }
            emit Approval(from, msg.sender, _allowances[from][msg.sender]);
        }

        _transfer(from, to, amount);
        return true;
    }

    /**
     * @notice Moves tokens between two nonzero accounts and emits the standard transfer event.
     * @param from Address whose balance will decrease.
     * @param to Address whose balance will increase.
     * @param amount Number of token base units to move.
     */
    function _transfer(address from, address to, uint256 amount) private {
        if (from == address(0) || to == address(0)) revert ZeroAddress();

        uint256 fromBalance = _balances[from];
        if (fromBalance < amount) revert InsufficientBalance(from, fromBalance, amount);

        unchecked {
            _balances[from] = fromBalance - amount;
        }
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }
}
