// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// safe imports
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

// personal import

contract Escrow is Ownable, IERC721Receiver {
    // type declarations

    // state variables
    uint8 public commissionRate; // percentage
    uint256 public personnalBalance = 0; // personal balance of the protocole
    mapping(address => uint256) public ownerBalance; // balance for all the owner of nfts using the protocole
    mapping(address => mapping(uint256 => address)) nftOwner; // first key assetContract, second key tokenId
    address public rentalManager;

    // events
    event BalanceWithdrawed(
        address indexed withdrawer,
        uint256 amount
    );


    // functions modifiers
    modifier onlyRentalManager() {
        require(msg.sender == rentalManager, "Only rentalManager is allowed to call");
        _;
    }

    // functions
    constructor() {}

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function setRentalManager(address _rentalManager) external onlyOwner {
        rentalManager = _rentalManager;
    }

    function setCommissionRate(uint8 _newCommissionRate) external onlyOwner {
        commissionRate = _newCommissionRate;
    }

    function transferNFTFrom(address assetContract, address from, address to, uint256 tokenId) public onlyRentalManager {
        ERC721(assetContract).safeTransferFrom(from, to, tokenId);
    }

    function transferCollateralFrom(address _erc20DenominationUsed, address _from, address _to, uint256 _amount) public onlyRentalManager returns (bool) {
        return ERC20(_erc20DenominationUsed).transferFrom(_from, _to, _amount);
        // require(succeed, "Failed to tranfer collateral from renter to contract");
    }

    function transferToRenter(address _renter, address _originalOwner, address _assetContract, uint256 _tokenId) external onlyRentalManager {
        nftOwner[_assetContract][_tokenId] = _originalOwner;
        ERC721(_assetContract).safeTransferFrom(_renter, address(this), _tokenId);
    }

    function payAndReturnCollateral(address _erc20DenominationUsed, address _to, uint256 _collateralAmount, address _ownerPaid, uint256 _paidAmount) public onlyRentalManager returns (bool) {
        ownerBalance[_ownerPaid] += _paidAmount;
        uint256 commission = _paidAmount * commissionRate / 100;
        personnalBalance += commission;
        return ERC20(_erc20DenominationUsed).transfer(_to, _collateralAmount - _paidAmount - commission);
        // require(success, "Transfer of collateral failed");
    }

    function liquidateCollateral(address _erc20DenominationUsed, address _to, uint256 _amount) public onlyRentalManager returns (bool) {
        // Do we take commission on liquidation ?
        return ERC20(_erc20DenominationUsed).transfer(_to, _amount);
    }

    function retreiveNFT(address _assetContract, uint256 _tokenId) external {
        require(msg.sender == nftOwner[_assetContract][_tokenId], "Not owner of this token");
        ERC721(_assetContract).safeTransferFrom(address(this), msg.sender, _tokenId); // use tranfer or it will revert
    }

    function withdrawBalance(address _erc20DenominationUsed) external {
        require(ownerBalance[msg.sender] > 0, "Not enough found");
        // remove balance before transfer to prevent reentrancy
        uint256 amount = ownerBalance[msg.sender];
        ownerBalance[msg.sender] = 0;
        bool success = ERC20(_erc20DenominationUsed).transfer(msg.sender, amount);
        require(success, "Failed to tranfer founds");
        emit BalanceWithdrawed(msg.sender, amount);
    }
}