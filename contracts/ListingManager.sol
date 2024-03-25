// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// safe imports
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ListingManager is Ownable {
    // type declarations
    enum ListingStatus { UNSET, PENDING, ACCEPTED, CANCELLED }
    struct ListingParameters {
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        uint256 pricePerDay;
        uint256 startTimestamp;  // timestamp for the start of the listing
        uint256 endTimestamp;    // timestamp for the end of the listing
        uint256 duration;        // timestamp for the duration of the renting
        bool isProRated;
    }
    struct ListingTime {
        uint256 startTimestamp;  // timestamp for the start of the listing
        uint256 endTimestamp;    // timestamp for the end of the listing
        uint256 duration;        // timestamp for the duration of the renting
    }
    struct Listing {
        uint256 listingId;
        address listingCreator;
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        uint256 pricePerDay;
        ListingTime listingTime;
        bool isProRated;
        ListingStatus status;
    }

    // state variables
    uint256 public totalNumListing = 0; // used as counter
    mapping(uint256 => Listing) public listingIdToListing;
    mapping(address => mapping(uint256 => bool)) public isTokenListed; // first key is contract address and second is token id
    address public rentalManager;
    // address public proposalManager;
    address public escrow; // address of escrow

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

    modifier onlyProtocol() {
        require(/*msg.sender == proposalManager ||*/ msg.sender == rentalManager, "Only called by protocole");
        _;
    }

    // functions
    constructor() {}

    // function setProposalManager(address _proposalManager) external onlyOwner {
    //     proposalManager = _proposalManager;
    // }

    function setRentalManager(address _rentalManager) external onlyOwner {
        rentalManager = _rentalManager;
    }

    function setEscrow(address _escrow) external onlyOwner {
        escrow = _escrow;
    }

    /// @dev Create a listing on the protocol.
    /// The NFT is not transfered in the Escrow at this steps.
    /// @param _listingParameters all the details needed for the listing like the token id, the token address, etc.
    function createListing(ListingParameters memory _listingParameters) external {
        require(isTokenListed[_listingParameters.assetContract][_listingParameters.tokenId] == false, "Can not create 2 listing of same NFT");
        require(_listingParameters.assetContract != address(0), "Invalid nft contract address");
        require(
            ERC721(_listingParameters.assetContract).isApprovedForAll(msg.sender, escrow) == true,
            "Escrow contract is not approved to transfer this nft"
        );
        require(
            ERC721(_listingParameters.assetContract).ownerOf(_listingParameters.tokenId) == msg.sender,
            "You are not the owner of the nft"
        );
        require(
            _listingParameters.startTimestamp >= block.timestamp && _listingParameters.endTimestamp > _listingParameters.startTimestamp, 
            "Invalid end timestamp"
        );
        require(_listingParameters.collateralAmount > 0, "Can't accept 0 collateral");
        require(_listingParameters.duration > 1 days, "Duration can't be less than one day");

        listingIdToListing[totalNumListing] = Listing(totalNumListing, msg.sender, _listingParameters.assetContract, _listingParameters.tokenId,
            _listingParameters.collateralAmount, _listingParameters.pricePerDay,
            ListingTime(_listingParameters.startTimestamp, _listingParameters.endTimestamp, _listingParameters.duration),
            _listingParameters.isProRated, ListingStatus.PENDING
        );
        isTokenListed[_listingParameters.assetContract][_listingParameters.tokenId] = true;
        emit ListingCreated(msg.sender, _listingParameters.assetContract, totalNumListing, listingIdToListing[totalNumListing]);
        totalNumListing++;
    }

    /// @param _listingId Id of the listing
    /// @param _listingParameters all the details needed for the listing like the token id, the token address, etc.
    /// @dev Update the listing, you can only update the collateralAmount, start & end timestamp, pricePerDay and the comment
    /// Note that the owner of the listing is checked with the modifier onlyListingOwner
    function updateListing(uint256 _listingId, ListingParameters memory _listingParameters) external onlyListingOwner(_listingId) {
        require(listingIdToListing[_listingId].status == ListingStatus.PENDING, "Listing is invalid");
        require(
            ERC721(_listingParameters.assetContract).isApprovedForAll(msg.sender, escrow) == true,
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
        listingIdToListing[_listingId].listingTime.startTimestamp = _listingParameters.startTimestamp;
        listingIdToListing[_listingId].listingTime.endTimestamp = _listingParameters.endTimestamp;
        listingIdToListing[_listingId].listingTime.duration = _listingParameters.duration;
        listingIdToListing[_listingId].pricePerDay = _listingParameters.pricePerDay;
        listingIdToListing[_listingId].isProRated = _listingParameters.isProRated;
        emit ListingUpdated(msg.sender, listingIdToListing[totalNumListing].assetContract, _listingId, listingIdToListing[_listingId]);
    }

    /// @param _listingId Id of the listing
    /// @dev Cancel a listing
    /// Note that the owner of the listing is checked with the modifier onlyListingOwner
    function cancelListing(uint256 _listingId) external onlyListingOwner(_listingId) {
        require(listingIdToListing[_listingId].status == ListingStatus.PENDING, "Listing is invalid");

        listingIdToListing[_listingId].status = ListingStatus.CANCELLED;
        emit ListingCancelled(msg.sender, _listingId);
        isTokenListed[listingIdToListing[_listingId].assetContract][listingIdToListing[_listingId].tokenId] = false;
    }

    /// @param _listingId Id of the listing
    /// @param _status Status to set the listing to
    /// @dev Allow the others contracts of the protocol to modify a listing 
    function setListingStatus(uint256 _listingId, ListingStatus _status) public onlyProtocol {
        listingIdToListing[_listingId].status = _status;
    }
}