// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
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
contract Lender is Ownable, IERC721Receiver {        
    /* ********** */
    /* DATA TYPES */
    /* ********** */

    enum ListingStatus {UNSET, PENDING, COMPLETED, CANCELLED}

    struct ListingParameters {
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        address erc20DenominationUsed;//unsued for the moment
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
        address erc20DenominationUsed; //unsued for the moment
        uint128 startTimestamp;
        uint128 endTimestamp;
        uint256 pricePerDay;
        string comment;         // needed ?
        ListingStatus status;
    }

    enum ProposalStatus {UNSET, PENDING, ACCEPTED, REFUSED, CANCELLED}

    struct ProposalParameters {
        uint128 startTimestampProposal;
        uint128 endTimestampProposal;
        uint128 startTimestampRental;
        uint128 endTimestampRental;
        bool isProRated;
    }

    struct Proposal {
        uint256 proposalId;
        uint256 listingId;
        address proposalCreator;
        uint128 startTimestampProposal;
        uint128 endTimestampProposal;
        uint128 startTimestampRental;
        uint128 endTimestampRental;
        bool isProRated;
        ProposalStatus status;
    }

    struct Rental {
        uint256 rentalId;
        address owner;
        address renter;
        address nftAddress;
        uint256 nftId;
        uint256 principalCollateralAmount;
        uint256 pricePerDay;
        uint128 startingDate;
        uint128 endingDate;
        bool isProRated;
    }

    /* ********* */
    /* MODIFIERS */
    /* ********* */

    modifier onlyListingOwner(uint256 listingId) {
        require(listingIdToListing[listingId].listingCreator == msg.sender, "Error: you are not the owner of the listing");
        _;
    }

    modifier onlyProposalOwner(uint256 proposalId) {
        require(proposalIdToProposal[proposalId].proposalCreator == msg.sender, "Error: you are not the owner of the proposal");
        _;
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

    event ProposalCreated(
        address indexed proposalCreator,
        uint256 indexed proposalId,
        uint256 indexed listingId,
        Proposal proposal
    );
    event ProposalUpdated(
        address indexed proposalCreator,
        uint256 indexed proposalId,
        uint256 indexed listingId,
        Proposal proposal
    );
    event ProposalCancelled(
        address indexed proposalCreator,
        uint256 indexed proposalId
    );


    event RentalCreated();
    event RentalReturned();
    event RentalLiquidated();

    /* ******* */
    /* STORAGE */
    /* ******* */

    // Accepted smart contract address for collateral purpose
    // Matic address ethereum: 0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0
    // Matic address polygon: 0x0000000000000000000000000000000000001010 
    // Matic address mumbai: 0x0000000000000000000000000000000000001010
    address public erc20DenominationUsed;

    uint256 public totalNumListing = 0; // used as counter

    mapping(uint256 => Listing) public listingIdToListing;

    mapping(address => mapping(uint256 => bool)) public isTokenListed; // first key is contract address and second is token id

    uint256 public totalNumProposal = 0; // used as counter

    mapping(uint256 => Proposal) public proposalIdToProposal;

    mapping (uint256 => uint256[20]) public listingIdToProposalsId; // usefull ?

    /* *********** */
    /* CONSTRUCTOR */
    /* *********** */

    constructor(address _erc20DenominationUsed) {
        erc20DenominationUsed = _erc20DenominationUsed;
    }

    /* ********* */
    /* FUNCTIONS */
    /* ********* */

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function createListing(ListingParameters memory _listingParameters) external {
        require(isTokenListed[_listingParameters.assetContract][_listingParameters.tokenId] == false, "Can not create 2 listing of same NFT");
        require(_listingParameters.assetContract != address(0), "Invalid nft contract address");
        require(
            ERC721(_listingParameters.assetContract).isApprovedForAll(msg.sender, address(this)) == true,
            "Escrow contract is not approved to transfer this nft"
        );
        require(address(_listingParameters.erc20DenominationUsed) != address(0), "Invalid erc20 contract address");
        require(
            _listingParameters.endTimestamp > block.timestamp && _listingParameters.endTimestamp > _listingParameters.startTimestamp, 
            "Invalid end timestamp"
        );
        require(_listingParameters.collateralAmount > 0, "Can't accept 0 collateral");
        // check if tokenId + addressContract already exist to not replicate listing

        listingIdToListing[totalNumListing] = Listing(totalNumListing, msg.sender, _listingParameters.assetContract, _listingParameters.tokenId,
            _listingParameters.collateralAmount, _listingParameters.erc20DenominationUsed, _listingParameters.startTimestamp, _listingParameters.endTimestamp,
            _listingParameters.pricePerDay, _listingParameters.comment, ListingStatus.PENDING
        );
        emit ListingCreated(msg.sender, _listingParameters.assetContract, totalNumListing, listingIdToListing[totalNumListing]);
        isTokenListed[_listingParameters.assetContract][_listingParameters.tokenId] = true;
        totalNumListing++;
    }

    function updateListing(uint256 _listingId, ListingParameters memory _listingParameters) external onlyListingOwner(_listingId) {
        require(listingIdToListing[_listingId].status == ListingStatus.PENDING, "Listing is invalid");
        require(address(_listingParameters.erc20DenominationUsed) != address(0), "Invalid erc20 contract address");
        require(
            _listingParameters.endTimestamp > block.timestamp && _listingParameters.endTimestamp > _listingParameters.startTimestamp, 
            "Invalid end timestamp"
        );
        require(_listingParameters.collateralAmount > 0, "Can't accept 0 collateral");

        listingIdToListing[_listingId].collateralAmount = _listingParameters.collateralAmount;
        listingIdToListing[_listingId].erc20DenominationUsed = _listingParameters.erc20DenominationUsed;
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

    function createProposal(uint256 _listingId, ProposalParameters memory _proposalParameters) external {
        require(isTokenListed[listingIdToListing[_listingId].assetContract][listingIdToListing[_listingId].tokenId], "Listing doesn't exist");
        // check if allowed to move collateral
        require(
            ERC20(erc20DenominationUsed).allowance(msg.sender, address(this)) >= listingIdToListing[_listingId].collateralAmount, 
            "Escrow contract is not approved to transfer collateral"
        );
        require(
            _proposalParameters.startTimestampProposal < _proposalParameters.endTimestampProposal && 
            _proposalParameters.startTimestampRental < _proposalParameters.endTimestampRental &&
            _proposalParameters.startTimestampProposal <= _proposalParameters.startTimestampRental &&
            listingIdToListing[_listingId].startTimestamp <= _proposalParameters.startTimestampRental &&
            listingIdToListing[_listingId].startTimestamp <= _proposalParameters.startTimestampProposal &&
            _proposalParameters.startTimestampProposal < listingIdToListing[_listingId].endTimestamp,
            "Timestamp error"
        );
        proposalIdToProposal[totalNumProposal] = Proposal(totalNumProposal, _listingId, msg.sender, _proposalParameters.startTimestampProposal, 
            _proposalParameters.endTimestampProposal, _proposalParameters.startTimestampRental, _proposalParameters.endTimestampRental, _proposalParameters.isProRated,
            ProposalStatus.PENDING
        );
        emit ProposalCreated(msg.sender, totalNumProposal, _listingId, proposalIdToProposal[totalNumProposal]);
        totalNumProposal++;
    }

    function updateProposal(uint256 _proposalId, ProposalParameters memory _proposalParameters) external onlyProposalOwner(_proposalId) {
        require(proposalIdToProposal[_proposalId].status == ProposalStatus.PENDING, "Proposal invalid");
        require(
            _proposalParameters.startTimestampProposal < _proposalParameters.endTimestampProposal && 
            _proposalParameters.startTimestampRental < _proposalParameters.endTimestampRental &&
            _proposalParameters.startTimestampProposal <= _proposalParameters.startTimestampRental &&
            listingIdToListing[proposalIdToProposal[_proposalId].listingId].startTimestamp <= _proposalParameters.startTimestampRental &&
            listingIdToListing[proposalIdToProposal[_proposalId].listingId].startTimestamp <= _proposalParameters.startTimestampProposal &&
            _proposalParameters.startTimestampProposal < listingIdToListing[proposalIdToProposal[_proposalId].listingId].endTimestamp,
            "Timestamp error"
        );
        proposalIdToProposal[_proposalId].startTimestampProposal = _proposalParameters.startTimestampProposal;
        proposalIdToProposal[_proposalId].endTimestampProposal = _proposalParameters.endTimestampProposal;
        proposalIdToProposal[_proposalId].startTimestampRental = _proposalParameters.startTimestampRental;
        proposalIdToProposal[_proposalId].endTimestampRental = _proposalParameters.endTimestampRental;
        proposalIdToProposal[_proposalId].isProRated = _proposalParameters.isProRated;
        emit ProposalUpdated(msg.sender, _proposalId, proposalIdToProposal[_proposalId].listingId, proposalIdToProposal[_proposalId]);
    }

    function cancelProposal(uint256 _proposalId) external onlyProposalOwner(_proposalId) {
        require(proposalIdToProposal[_proposalId].status == ProposalStatus.PENDING, "Proposal invalid");

        proposalIdToProposal[_proposalId].status = ProposalStatus.CANCELLED;
        emit ProposalCancelled(msg.sender, _proposalId);
    }

    function acceptProposal(uint256 _proposalId) external onlyListingOwner(proposalIdToProposal[_proposalId].listingId) {
        // check if listing and proposal are valid
        // check if timestamps are expired
        // check if allowed to transfer nft
        // check if allowed to transfer founds
        // create rental
    }
}