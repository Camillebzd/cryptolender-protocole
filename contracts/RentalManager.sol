// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

// safe imports
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// personal import
import "./ListingManager.sol";
import "./Vault.sol";
import "./libraries/PriceCalculator.sol";

import "hardhat/console.sol";

contract RentalManager is Ownable {
    // type declarations
    enum RentalStatus { UNSET, ACTIVE, EXPIRED, REFUND, LIQUIDATED }
    struct RentalDetails {
        address initialOwner;   // original owner of the nft
        address renter;         // renter of the nft
        address assetContract;
        uint256 tokenId;
        uint256 collateralAmount;
        uint256 pricePerDay;
        uint256 startingDate;   // start of the rental
        uint256 endingDate;     // maximum time for the end of the rental
        bool isProRated;
    }
    // struct RentalInfo {
    //     uint256 listingId;
    //     uint256 proposalId;
    // }
    struct Rental {
        uint256 rentalId;
        RentalDetails details;
        uint256 listingId;
        // RentalInfo info;
        RentalStatus status;
    }

    // state variables
    uint256 public totalNumRental = 0; // used as counter
    mapping(uint256 => Rental) public rentalIdToRental;
    address public erc20DenominationUsed; // Handle outside
    address public listingManager;
    address public proposalManager;
    address payable public vault; // used only if not inherited here

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
    // modifier onlyProposalManager() {
    //     require(msg.sender == proposalManager, "Only proposalManager is allowed to call");
    //     _;
    // }

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

    function setVault(address _vault) external onlyOwner {
        vault = payable(_vault);
    }

    /// @dev calculate the price of a rent, include 0.3% fees on the rent amount
    function findMinimumAmountNeeded(uint256 collateralAmount, uint256 pricePerDay, uint256 duration) pure internal returns(uint256) {
    }

    /// @dev Accept a listing and send native tokens to the vault and receive the NFT from user.
    function createRental(uint256 _listingId) external payable {
        (
            ,
            address listingCreator,
            address assetContract,
            uint256 tokenId,
            uint256 collateralAmount,
            uint256 pricePerDay,
            ListingManager.ListingTime memory listingTime,
            bool isProRated,
            ListingManager.ListingStatus status
        ) = ListingManager(listingManager).listingIdToListing(_listingId);
        // Checks
        require(status == ListingManager.ListingStatus.AVAILABLE, "Listing is invalid");
        require(block.timestamp < listingTime.endTimestamp && block.timestamp > listingTime.startTimestamp, "Listing is invalid");
        // Needed?
        // require(
        //     ERC721(assetContract).isApprovedForAll(listingCreator, vault) == true,
        //     "Vault contract is not approved to transfer this nft"
        // );
        uint256 rentPrice = PriceCalculator.calculateRentPrice(
            block.timestamp,
            block.timestamp + listingTime.duration,
            pricePerDay,
            false // always set isProRated to false to force calculation for the full time
        );
        uint256 fees = PriceCalculator.calculateFees(rentPrice);
        uint256 minimumAmount = collateralAmount + rentPrice + fees;
        require(msg.value == minimumAmount, "Not the right amount of token");

        // transfer tokens to vault
        Vault(vault).storeTokens{value: msg.value}(fees);
        // Create rental and emit event
        rentalIdToRental[totalNumRental] = Rental(totalNumRental, 
            RentalDetails(
                listingCreator,
                msg.sender,
                assetContract,
                tokenId,
                collateralAmount,
                pricePerDay,
                block.timestamp,
                block.timestamp + listingTime.duration,
                isProRated
            ), _listingId, RentalStatus.ACTIVE
        );
        // Set the listing as accepted
        ListingManager(listingManager).setListingStatus(_listingId, ListingManager.ListingStatus.RENTED);
        emit RentalCreated(listingCreator, msg.sender, totalNumRental, rentalIdToRental[totalNumRental]);
        totalNumRental++;
        // transfer NFT to user at the end to protect again any reentrancy
        IERC721(assetContract).safeTransferFrom(listingCreator, msg.sender, tokenId);
    }

    /// @dev For the moment we block refund if this is not the original renter
    /// The NFT is stored in the Vault because if the original user stop the
    /// automatic send of the NFT, the renter could be blocked without any
    /// ways to refund the rental! (Pull over push)
    /// @param _rentalId Id of the rental
    function refundRental(uint256 _rentalId) external {
        Rental storage rental = rentalIdToRental[_rentalId];
        require(rental.details.renter == msg.sender, "Not allowed to renfund");
        require(
            rental.status == RentalStatus.ACTIVE || 
            rental.status == RentalStatus.EXPIRED, 
            "Rental invalid"
        );
        require(
            ERC721(rental.details.assetContract).isApprovedForAll(msg.sender, vault) == true,
            "Vault contract is not approved to transfer this nft"
        );
        // Needed?
        // require(
        //     ERC721(rental.details.assetContract).ownerOf(rental.details.tokenId) == msg.sender,
        //     "You are not the owner of the nft"
        // );
        rental.status = RentalStatus.REFUND;
        Vault(vault).storeNFT(rental.details.initialOwner, rental.details.renter, rental.details.assetContract, rental.details.tokenId);
        // uint256 timeDifference = 0;
        // if (rental.details.isProRated) {
        //     timeDifference = block.timestamp - rental.details.startingDate;
        // } else {
        //     // divide by 1000 since js use millisecond and solidity use second
        //     timeDifference = rental.details.endingDate / 1000 - rental.details.startingDate; // point of problem?
        // }
        // uint256 secondsPerDay = 24 * 60 * 60;
        // // calculate the number of days (rounded up)
        // uint256 numberOfDays = (timeDifference + (secondsPerDay - 1)) / secondsPerDay;
        // uint256 priceToPay = rental.details.pricePerDay * numberOfDays;
        uint256 refundIfProRated = 0;
        if (rental.details.isProRated) {
            uint256 priceSent = PriceCalculator.calculateRentPrice(
                rental.details.startingDate,
                rental.details.endingDate,
                rental.details.pricePerDay,
                false
            );
            uint256 priceProRated = PriceCalculator.calculateRentPrice(
                rental.details.startingDate,
                block.timestamp,
                rental.details.pricePerDay,
                true
            );
            refundIfProRated = priceSent - priceProRated;
        }
        Vault(vault).returnCollateral(rental.details.renter, rental.details.collateralAmount + refundIfProRated);
        emit RentalRefunded(rental.details.initialOwner, msg.sender, rental.rentalId, rental);
    }

    /// @dev This method can be used by the original owner if the renter didn't come back with the NFT.
    /// @param _rentalId Id of the rental
    function liquidateRental(uint256 _rentalId) external {
        Rental storage rental = rentalIdToRental[_rentalId];
        require(rental.details.initialOwner == msg.sender, "Not allowed to liquidate");
        require(
            rental.status == RentalStatus.EXPIRED || 
            (block.timestamp > rental.details.endingDate && rental.status == RentalStatus.ACTIVE), 
            "Rental invalid"
        );
        // bool success = Vault(vault).liquidateCollateral(erc20DenominationUsed, msg.sender, rental.details.collateralAmount);
        // require(success, "Failed to liquidate and transfer collateral");
        uint256 rentPrice = PriceCalculator.calculateRentPrice(
            rental.details.startingDate,
            rental.details.endingDate,
            rental.details.pricePerDay,
            false
        );
        rental.status = RentalStatus.LIQUIDATED;
        emit RentalLiquidated(msg.sender, rental.details.renter, _rentalId, rental);
        Vault(vault).liquidateCollateral(msg.sender, rental.details.collateralAmount + rentPrice);
    }

    // fct for the owner to retreive the tokens -> maybe on the Vault

    // chainlink monitoring
    // -> monitor timestamps of listing, proposal and rental
    // -> monitor collateral amount during rental
}