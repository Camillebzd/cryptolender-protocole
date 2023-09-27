// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// This contract is here only for testing purpose, it is not part of the protocole!
contract MyToken20 is ERC20, Ownable {
    constructor() ERC20("MyToken20", "MTK20") {}

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}