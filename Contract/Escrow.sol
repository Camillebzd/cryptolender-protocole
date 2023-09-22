// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Steps to use:
// 1. The lender needs to approve the contract from the NFT contract (approveAll for only one transaction)
// 2. The lender will create a listing (which will appear on the website)
// 3. The renter will needs to approve the contract from ERC20 contract used for the collateral
// 4. The renter will create a proposal
// 5. The lender accept one the proposal and create the Rental (respecting the timer in the proposal), the contract will transfere the nft from lender 
//    to renter and the ERC20 token amount from the renter to this contract as collateral (if one of the transfere failed
//    for any raisons, the UI will explain why but nothing will be transfered).
// pro rated system ?
contract Escrow is Ownable, IERC721Receiver {        
    /* ********** */
    /* DATA TYPES */
    /* ********** */

    enum ListingStatus {UNSET, PENDING, COMPLETED, CANCELLED}

    struct ListingParameters {
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        address ERC20DenominationUsed;
        uint128 startTimestamp;
        uint128 endTimestamp;
        uint256 pricePerDay;
        string comment;
    }

    struct Listing {
        uint256 listingId;
        address listingCreator;
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        address ERC20DenominationUsed;
        uint128 startTimestamp;
        uint128 endTimestamp;
        uint256 pricePerDay;
        string comment;         // needed ?
        ListingStatus status;
    }

    enum ProposalStatus {UNSET, PENDING, ACCEPTED, REFUSED}

    struct Proposal {
        uint256 listingId;
        address proposalCreator;
        address ERC20DenominationUsed;
        uint128 startTimestampProposal;
        uint128 endTimestampProposal;
        uint128 startTimestampRental;
        uint128 endTimestampRental;
        bool isProRated;
        ProposalStatus status;
    }

    struct Rental {
        uint256 rentalId;                   // Id of the rental
        address owner;                      // Owner of the NFT
        address renter;                     // Renter of the NFT
        address nftAddress;                 // address of the NFT contract
        uint256 nftId;                      // id of the NFT
        uint256 principalCollateralAmount;
        uint256 pricePerDay;
        uint128 startingDate;
        uint128 endingDate;
        bool isProRated;
    }

    /* ******* */
    /*  EVENT  */
    /* ******* */

    event ListingCreated(
        address indexed listingCreator,
        address indexed assetContract,
        uint256 indexed listingId,
        Listing listing
    );
    event UpdatedListing(
        address indexed listingCreator,
        address indexed assetContract,
        uint256 indexed listingId,
        Listing listing
    );
    event CancelledListing(
        address indexed listingCreator,
        uint256 indexed listingId
    );

    event RentalCreated();
    event RentalReturned();
    event RentalLiquidated();

    /* ******* */
    /* STORAGE */
    /* ******* */

    uint256 public totalNumListing = 0;

    mapping(uint256 => Listing) listingIdToListing;

    /* *********** */
    /* CONSTRUCTOR */
    /* *********** */

    constructor() {}

    /* ********* */
    /* FUNCTIONS */
    /* ********* */

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function createListing(ListingParameters memory _listingParameters) external {
        require(_listingParameters.assetContract != address(0), "Escrow: Invalid nft contract address");
        require(
            ERC721(_listingParameters.assetContract).getApproved(_listingParameters.tokenId) == address(this),
            "Escrow: Escrow contract is not approved to transfer this nft"
        );
        require(address(_listingParameters.ERC20DenominationUsed) != address(0), "Escrow: Invalid erc20 contract address");
        require(
            _listingParameters.endTimestamp > block.timestamp && _listingParameters.endTimestamp > _listingParameters.startTimestamp, 
            "Escrow: Invalid end timestamp"
        );
        require(_listingParameters.collateralAmount > 0, "Escrow: Can't accept 0 collateral");

        listingIdToListing[totalNumListing] = Listing(totalNumListing, msg.sender, _listingParameters.assetContract, _listingParameters.tokenId,
            _listingParameters.collateralAmount, _listingParameters.ERC20DenominationUsed, _listingParameters.startTimestamp, _listingParameters.endTimestamp,
            _listingParameters.pricePerDay, _listingParameters.comment, ListingStatus.PENDING
        );
        emit ListingCreated(msg.sender, _listingParameters.assetContract, totalNumListing, listingIdToListing[totalNumListing]);
        totalNumListing++;
    }
}