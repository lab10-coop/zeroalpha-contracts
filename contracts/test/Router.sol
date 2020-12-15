// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "../ArtSteward.sol"; // dont need an interface since it's a test contract

/*
Testing contract which can sometimes not receive ETH
*/

contract Router {

    ArtSteward steward;
    bool public toBlock = true;

    constructor (address payable _steward) public {
        steward = ArtSteward(_steward);
    }

    function buyFor1ETH(uint256 currentPrice) public payable {
        // steward.buy{value: msg.value}(1 ether, currentPrice);
        // note: for some reason, it can't determine difference between buy(uint256) & buy(uint256,uint256)
        // Thus: manually creating this call for testing
        address(steward).call{value: msg.value}(abi.encodeWithSignature("buy(uint256,uint256)", 1 ether, currentPrice));
    }

    function withdrawPullFunds() public {
        steward.withdrawPullFunds();
    }

    receive() external payable {
        if(toBlock) { revert('blocked'); }
    }

    function setBlock(bool _tb) public {
        toBlock = _tb;
    }
}