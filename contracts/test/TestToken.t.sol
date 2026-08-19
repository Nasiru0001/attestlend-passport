// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {TestToken} from "../source/TestToken.sol";

/**
 * @title TestTokenTest
 * @notice Verifies the test token faucet, transfer, approval, and delegated transfer behavior.
 */
contract TestTokenTest is Test {
    TestToken private token;
    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");
    address private spender = makeAddr("spender");

    /**
     * @notice Deploys a fresh test token before each test.
     */
    function setUp() external {
        token = new TestToken();
    }

    /**
     * @notice Confirms the public faucet mints the requested amount and updates total supply.
     */
    function testFaucetMintsTokens() external {
        assertTrue(token.faucet(alice, 1_000 ether));
        assertEq(token.balanceOf(alice), 1_000 ether);
        assertEq(token.totalSupply(), 1_000 ether);
    }

    /**
     * @notice Confirms a holder can transfer tokens directly to another account.
     */
    function testTransferMovesTokens() external {
        token.faucet(alice, 100 ether);

        vm.prank(alice);
        assertTrue(token.transfer(bob, 40 ether));

        assertEq(token.balanceOf(alice), 60 ether);
        assertEq(token.balanceOf(bob), 40 ether);
    }

    /**
     * @notice Confirms a spender can transfer approved tokens and that finite allowance decreases.
     */
    function testTransferFromUsesAllowance() external {
        token.faucet(alice, 100 ether);

        vm.prank(alice);
        token.approve(spender, 50 ether);

        vm.prank(spender);
        assertTrue(token.transferFrom(alice, bob, 30 ether));

        assertEq(token.balanceOf(alice), 70 ether);
        assertEq(token.balanceOf(bob), 30 ether);
        assertEq(token.allowance(alice, spender), 20 ether);
    }

    /**
     * @notice Confirms delegated transfers revert when allowance is below the requested amount.
     */
    function testTransferFromRevertsForInsufficientAllowance() external {
        token.faucet(alice, 100 ether);

        vm.prank(alice);
        token.approve(spender, 10 ether);

        vm.expectRevert(
            abi.encodeWithSelector(TestToken.InsufficientAllowance.selector, alice, spender, 10 ether, 20 ether)
        );
        vm.prank(spender);
        token.transferFrom(alice, bob, 20 ether);
    }
}
