// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// safe imports
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// personal import
import "./ListingManager.sol";

contract ProposalManager is Ownable {
    // type declarations
    enum ProposalStatus {UNSET, PENDING, ACCEPTED, REFUSED, CANCELLED}

    struct ProposalParameters {
        uint256 startTimestampProposal;
        uint256 endTimestampProposal;
        uint256 endTimestampRental;
        bool isProRated;
    }

    struct Proposal {
        uint256 proposalId;
        uint256 listingId;
        address proposalCreator;
        uint256 startTimestampProposal;
        uint256 endTimestampProposal;
        uint256 endTimestampRental;
        bool isProRated;
        ProposalStatus status;
    }

    // state variables
    address public listingManager;
    address public rentalManager;
    uint256 public totalNumProposal = 0; // used as counter
    mapping(uint256 => Proposal) public proposalIdToProposal;
    address public erc20DenominationUsed; // Handle outside 

    // events
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

    // functions modifiers
    modifier onlyProposalOwner(uint256 proposalId) {
        require(proposalIdToProposal[proposalId].proposalCreator == msg.sender, "Error: you are not the owner of the proposal");
        _;
    }

    // functions
    constructor() {}

    function setListingManager(address _listingManager) external onlyOwner {
        listingManager = _listingManager;
    }

    function setRentalManager(address _rentalManager) external onlyOwner {
        rentalManager = _rentalManager;
    }

    function createProposal(uint256 _listingId, ProposalParameters memory _proposalParameters) external {
        // require(isTokenListed[listingIdToListing[_listingId].assetContract][listingIdToListing[_listingId].tokenId], "Listing doesn't exist");
        (
            ,,,,
            uint256 listingCollateralAmount,
            uint256 listingStartTimestamp,
            uint256 listingEndTimestamp,
            ,,
            ListingManager.ListingStatus listingStatus
        ) = ListingManager(listingManager).listingIdToListing(_listingId);
        require(listingStatus == ListingManager.ListingStatus.PENDING, "Listing invalid");
        // check if allowed to move collateral
        require(
            ERC20(erc20DenominationUsed).allowance(msg.sender, address(this)) >= listingCollateralAmount, 
            "Contract is not approved to transfer collateral"
        );
        require(
            ERC20(erc20DenominationUsed).balanceOf(msg.sender) >= listingCollateralAmount,
            "Not enough token balance to cover the collateral"
        );
        require(
            _proposalParameters.startTimestampProposal < _proposalParameters.endTimestampProposal && 
            _proposalParameters.startTimestampProposal < _proposalParameters.endTimestampRental &&
            listingStartTimestamp <= _proposalParameters.startTimestampProposal &&
            _proposalParameters.startTimestampProposal < listingEndTimestamp,
            "Timestamp error"
        );
        proposalIdToProposal[totalNumProposal] = Proposal(totalNumProposal, _listingId, msg.sender, _proposalParameters.startTimestampProposal, 
            _proposalParameters.endTimestampProposal, _proposalParameters.endTimestampRental, _proposalParameters.isProRated,
            ProposalStatus.PENDING
        );
        emit ProposalCreated(msg.sender, totalNumProposal, _listingId, proposalIdToProposal[totalNumProposal]);
        totalNumProposal++;
    }

    function updateProposal(uint256 _proposalId, ProposalParameters memory _proposalParameters) external onlyProposalOwner(_proposalId) {
        require(proposalIdToProposal[_proposalId].status == ProposalStatus.PENDING, "Proposal invalid");
        (
            ,,,,
            uint256 listingCollateralAmount,
            uint256 listingStartTimestamp,
            uint256 listingEndTimestamp,
            ,,
            ListingManager.ListingStatus listingStatus
        ) = ListingManager(listingManager).listingIdToListing(proposalIdToProposal[_proposalId].listingId);
        require(listingStatus == ListingManager.ListingStatus.PENDING, "Listing invalid");
        // check if allowed to move collateral
        require(
            ERC20(erc20DenominationUsed).allowance(msg.sender, address(this)) >= listingCollateralAmount, 
            "Contract is not approved to transfer collateral"
        );
        require(
            ERC20(erc20DenominationUsed).balanceOf(msg.sender) >= listingCollateralAmount,
            "Not enough token balance to cover the collateral"
        );
        require(
            _proposalParameters.startTimestampProposal < _proposalParameters.endTimestampProposal && 
            _proposalParameters.startTimestampProposal < _proposalParameters.endTimestampRental &&
            listingStartTimestamp <= _proposalParameters.startTimestampProposal &&
            _proposalParameters.startTimestampProposal < listingEndTimestamp,
            "Timestamp error"
        );
        proposalIdToProposal[_proposalId].startTimestampProposal = _proposalParameters.startTimestampProposal;
        proposalIdToProposal[_proposalId].endTimestampProposal = _proposalParameters.endTimestampProposal;
        proposalIdToProposal[_proposalId].endTimestampRental = _proposalParameters.endTimestampRental;
        proposalIdToProposal[_proposalId].isProRated = _proposalParameters.isProRated;
        emit ProposalUpdated(msg.sender, _proposalId, proposalIdToProposal[_proposalId].listingId, proposalIdToProposal[_proposalId]);
    }

    function cancelProposal(uint256 _proposalId) external onlyProposalOwner(_proposalId) {
        require(proposalIdToProposal[_proposalId].status == ProposalStatus.PENDING, "Proposal invalid");

        proposalIdToProposal[_proposalId].status = ProposalStatus.CANCELLED;
        emit ProposalCancelled(msg.sender, _proposalId);
    }

    function acceptProposal(uint256 _proposalId) external view {
        Proposal memory proposal = proposalIdToProposal[_proposalId];
        (
            ,
            address listingCreator,
            address listingAssetContract,
            uint256 listingTokenId,
            uint256 listingCollateralAmount,
            ,
            uint256 listingEndTimestamp,
            ,,
            ListingManager.ListingStatus listingStatus
        ) = ListingManager(listingManager).listingIdToListing(proposalIdToProposal[_proposalId].listingId);
        // check owner
        require(listingCreator == msg.sender, "Not allowed to accept this proposal");
        // check if listing and proposal are valid
        require(proposal.status == ProposalStatus.PENDING, "Proposal invalid");
        require(listingStatus == ListingManager.ListingStatus.PENDING, "Listing invalid");
        // check if timestamps are expired
        require(listingEndTimestamp > block.timestamp, "Listing expired");
        require(proposal.endTimestampProposal > block.timestamp && proposal.endTimestampRental > block.timestamp, "Proposal expired");
        // check if allowed to transfer nft
        require(
            ERC721(listingAssetContract).isApprovedForAll(msg.sender, address(this)) == true,
            "Escrow contract is not approved to transfer this nft"
        );
        require(
            ERC721(listingAssetContract).ownerOf(listingTokenId) == msg.sender,
            "You are not the owner of the nft"
        );
        // check if allowed to transfer founds
         require(
            ERC20(erc20DenominationUsed).allowance(proposal.proposalCreator, address(this)) >= listingCollateralAmount, 
            "Escrow contract is not approved to transfer collateral"
        );
        require(
            ERC20(erc20DenominationUsed).balanceOf(proposal.proposalCreator) >= listingCollateralAmount, 
            "Not enough token balance to cover the collateral"
        );
        // -> create obj rental
        // EXTRACT THIS CODE IN RENTAL MANAGER
        // rentalIdToRental[totalNumRental] = Rental(totalNumRental, msg.sender, 
        //     proposal.proposalCreator, listing.assetContract, listing.tokenId, listing.collateralAmount, listing.pricePerDay,
        //     block.timestamp, proposal.endTimestampRental, proposal.isProRated, RentalStatus.ACTIVE
        // );
        // // -> moove nft to the renter
        // ERC721(listing.assetContract).safeTransferFrom(msg.sender, proposal.proposalCreator, listing.tokenId);
        // // -> moove collateral
        // bool succeed = ERC20(erc20DenominationUsed).transferFrom(proposal.proposalCreator, address(this), listing.collateralAmount);
        // require(succeed, "Failed to tranfer collateral from renter to contract");
        // // -> emit rental creation
        // emit RentalCreated(msg.sender, proposal.proposalCreator, totalNumRental, rentalIdToRental[totalNumRental]);
        // listingIdToListing[proposal.listingId].status = ListingStatus.COMPLETED;
        // proposalIdToProposal[_proposalId].status = ProposalStatus.ACCEPTED;
        // totalNumRental++;
    }

}