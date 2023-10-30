// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// safe imports
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// personal import
import "./ListingManager.sol";
import "./ProposalManager.sol";
import "./Escrow.sol";

import "hardhat/console.sol";

contract RentalManager is Ownable {
    // type declarations
    enum RentalStatus {UNSET, ACTIVE, EXPIRED, REFUND, LIQUIDATED}
    struct RentalDetails {
        address owner;
        address renter;
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        uint256 pricePerDay;
        uint256 startingDate;
        uint256 endingDate;
        bool isProRated;
    }
    struct RentalInfo {
        uint256 listingId;
        uint256 proposalId;
    }
    struct Rental {
        uint256 rentalId;
        RentalDetails details;
        RentalInfo info;
        RentalStatus status;
    }

    // state variables
    uint256 public totalNumRental = 0; // used as counter
    mapping(uint256 => Rental) public rentalIdToRental;
    address public erc20DenominationUsed; // Handle outside
    address public listingManager;
    address public proposalManager;
    address public escrow; // used only if not inherited here

    // events
    event RentalCreated(
        address indexed owner,
        address indexed renter,
        uint256 indexed rentalId,
        Rental rental
    );
    event RentalRefunded(
        address indexed owner,
        address indexed renter,
        uint256 indexed rentalId,
        Rental rental
    );
    event RentalLiquidated(
        address indexed owner,
        address indexed renter,
        uint256 indexed rentalId,
        Rental rental
    );

    // functions modifiers
    modifier onlyProposalManager() {
        require(msg.sender == proposalManager, "Only proposalManager is allowed to call");
        _;
    }

    // functions
    constructor() {}
    
    function setERC20(address _erc20DenominationUsed) external onlyOwner {
        erc20DenominationUsed = _erc20DenominationUsed;
    }

    function setListingManager(address _listingManager) external onlyOwner {
        listingManager = _listingManager;
    }

    function setProposalManager(address _proposalManager) external onlyOwner {
        proposalManager = _proposalManager;
    }

    function setEscrow(address _escrow) external onlyOwner {
        escrow = _escrow;
    }

    function createRental(RentalDetails memory _details, RentalInfo memory _info) external onlyProposalManager {
        rentalIdToRental[totalNumRental] = Rental(totalNumRental, _details, _info, RentalStatus.ACTIVE);
        Escrow(escrow).transferNFTFrom(_details.assetContract, _details.owner, _details.renter, _details.tokenId);
        Escrow(escrow).safeTransferCollateralFrom(erc20DenominationUsed, _details.renter, escrow, _details.collateralAmount);
        emit RentalCreated(_details.owner, _details.renter, totalNumRental, rentalIdToRental[totalNumRental]);
        // listingIdToListing[proposal.listingId].status = ListingStatus.COMPLETED;
        // proposalIdToProposal[_proposalId].status = ProposalStatus.ACCEPTED;
        totalNumRental++;
    }

    function refundRental(uint256 _rentalId) external {
        // For the moment we block refund if this is not the original renter
        require(rentalIdToRental[_rentalId].details.renter == msg.sender, "Not allowed to renfund");
        require(
            rentalIdToRental[_rentalId].status == RentalStatus.ACTIVE || 
            rentalIdToRental[_rentalId].status == RentalStatus.EXPIRED, 
            "Rental invalid"
        );
        require(
            ERC721(rentalIdToRental[_rentalId].details.assetContract).isApprovedForAll(msg.sender, escrow) == true,
            "Escrow contract is not approved to transfer this nft"
        );
        require(
            ERC721(rentalIdToRental[_rentalId].details.assetContract).ownerOf(rentalIdToRental[_rentalId].details.tokenId) == msg.sender,
            "You are not the owner of the nft"
        );
        Escrow(escrow).safeTransferToRenter(rentalIdToRental[_rentalId].details.renter, rentalIdToRental[_rentalId].details.owner, rentalIdToRental[_rentalId].details.assetContract, rentalIdToRental[_rentalId].details.tokenId);
        uint256 timeDifference = 0;
        if (rentalIdToRental[_rentalId].details.isProRated) {
            timeDifference = block.timestamp - rentalIdToRental[_rentalId].details.startingDate;
        } else {
            // divide by 1000 since js use millisecond and solidity use second
            timeDifference = rentalIdToRental[_rentalId].details.endingDate / 1000 - rentalIdToRental[_rentalId].details.startingDate;
        }
        uint256 secondsPerDay = 24 * 60 * 60;
        // calculate the number of days (rounded up)
        uint256 numberOfDays = (timeDifference + (secondsPerDay - 1)) / secondsPerDay;
        uint256 priceToPay = rentalIdToRental[_rentalId].details.pricePerDay * numberOfDays;
        Escrow(escrow).payAndReturnCollateral(erc20DenominationUsed, msg.sender, rentalIdToRental[_rentalId].details.collateralAmount, rentalIdToRental[_rentalId].details.owner, priceToPay);
        rentalIdToRental[_rentalId].status = RentalStatus.REFUND;
        emit RentalRefunded(rentalIdToRental[_rentalId].details.owner, msg.sender, rentalIdToRental[_rentalId].rentalId, rentalIdToRental[_rentalId]);
    }

    function liquidateRental(uint256 _rentalId) external {
        require(rentalIdToRental[_rentalId].details.owner == msg.sender, "Not allowed to liquidate");
        require(
            rentalIdToRental[_rentalId].status == RentalStatus.EXPIRED || 
            (block.timestamp > rentalIdToRental[_rentalId].details.endingDate && rentalIdToRental[_rentalId].status == RentalStatus.ACTIVE), 
            "Rental invalid"
        );
        bool success = Escrow(escrow).liquidateCollateral(erc20DenominationUsed, msg.sender, rentalIdToRental[_rentalId].details.collateralAmount);
        require(success, "Failed to liquidate and transfer collateral");
        rentalIdToRental[_rentalId].status = RentalStatus.LIQUIDATED;
        emit RentalLiquidated(msg.sender, rentalIdToRental[_rentalId].details.renter, _rentalId, rentalIdToRental[_rentalId]);
    }

    // fct for the owner to retreive the tokens

    // chainlink monitoring
    // -> monitor timestamps of listing, proposal and rental
    // -> monitor collateral amount during rental
}