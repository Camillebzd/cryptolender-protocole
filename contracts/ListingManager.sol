// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// safe imports
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ListingManager is Ownable {
    // type declarations
    enum ListingStatus {UNSET, PENDING, COMPLETED, CANCELLED}
    struct ListingParameters {
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 pricePerDay;
        string comment;
    }
    struct Listing {
        uint256 listingId;
        address listingCreator;
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 pricePerDay;
        string comment;         // needed ?
        ListingStatus status;
    }

    // state variables
    uint256 public totalNumListing = 0; // used as counter
    mapping(uint256 => Listing) public listingIdToListing;
    mapping(address => mapping(uint256 => bool)) public isTokenListed; // first key is contract address and second is token id
    address public proposalManagerContract; // address of escrow and rental manager contract

    // events
    event ListingCreated(
        address indexed listingCreator,
        address indexed assetContract,
        uint256 indexed listingId,
        Listing listing
    );
    event ListingUpdated(
        address indexed listingCreator,
        address indexed assetContract,
        uint256 indexed listingId,
        Listing listing
    );
    event ListingCancelled(
        address indexed listingCreator,
        uint256 indexed listingId
    );

    // functions modifiers
    modifier onlyListingOwner(uint256 listingId) {
        require(listingIdToListing[listingId].listingCreator == msg.sender, "Error: you are not the owner of the listing");
        _;
    }

    // functions
    constructor() {}

    function setProposalManagerContract(address _proposalManagerContract) external onlyOwner {
        proposalManagerContract = _proposalManagerContract;
    }

    function createListing(ListingParameters memory _listingParameters) external {
        require(isTokenListed[_listingParameters.assetContract][_listingParameters.tokenId] == false, "Can not create 2 listing of same NFT");
        require(_listingParameters.assetContract != address(0), "Invalid nft contract address");
        require(
            ERC721(_listingParameters.assetContract).isApprovedForAll(msg.sender, proposalManagerContract) == true,
            "Escrow contract is not approved to transfer this nft"
        );
        require(
            ERC721(_listingParameters.assetContract).ownerOf(_listingParameters.tokenId) == msg.sender,
            "You are not the owner of the nft"
        );
        require(
            _listingParameters.endTimestamp > block.timestamp && _listingParameters.endTimestamp > _listingParameters.startTimestamp, 
            "Invalid end timestamp"
        );
        require(_listingParameters.collateralAmount > 0, "Can't accept 0 collateral");

        listingIdToListing[totalNumListing] = Listing(totalNumListing, msg.sender, _listingParameters.assetContract, _listingParameters.tokenId,
            _listingParameters.collateralAmount, _listingParameters.startTimestamp, _listingParameters.endTimestamp,
            _listingParameters.pricePerDay, _listingParameters.comment, ListingStatus.PENDING
        );
        isTokenListed[_listingParameters.assetContract][_listingParameters.tokenId] = true;
        emit ListingCreated(msg.sender, _listingParameters.assetContract, totalNumListing, listingIdToListing[totalNumListing]);
        totalNumListing++;
    }

    function updateListing(uint256 _listingId, ListingParameters memory _listingParameters) external onlyListingOwner(_listingId) {
        require(listingIdToListing[_listingId].status == ListingStatus.PENDING, "Listing is invalid");
        require(
            ERC721(_listingParameters.assetContract).isApprovedForAll(msg.sender, proposalManagerContract) == true,
            "Escrow contract is not approved to transfer this nft"
        );
        require(
            ERC721(_listingParameters.assetContract).ownerOf(_listingParameters.tokenId) == msg.sender,
            "You are not the owner of the nft"
        );
        require(
            _listingParameters.endTimestamp > block.timestamp && _listingParameters.endTimestamp > _listingParameters.startTimestamp, 
            "Invalid end timestamp"
        );
        require(_listingParameters.collateralAmount > 0, "Can't accept 0 collateral");

        listingIdToListing[_listingId].collateralAmount = _listingParameters.collateralAmount;
        listingIdToListing[_listingId].startTimestamp = _listingParameters.startTimestamp;
        listingIdToListing[_listingId].endTimestamp = _listingParameters.endTimestamp;
        listingIdToListing[_listingId].pricePerDay = _listingParameters.pricePerDay;
        listingIdToListing[_listingId].comment = _listingParameters.comment;
        emit ListingUpdated(msg.sender, listingIdToListing[totalNumListing].assetContract, _listingId, listingIdToListing[_listingId]);
    }

    function cancelListing(uint256 _listingId) external onlyListingOwner(_listingId) {
        require(listingIdToListing[_listingId].status == ListingStatus.PENDING, "Listing is invalid");

        listingIdToListing[_listingId].status = ListingStatus.CANCELLED;
        emit ListingCancelled(msg.sender, _listingId);
        isTokenListed[listingIdToListing[_listingId].assetContract][listingIdToListing[_listingId].tokenId] = false;
    }
}