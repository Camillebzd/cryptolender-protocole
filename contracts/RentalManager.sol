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

// debug
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
    struct Rental {
        uint256 rentalId;
        RentalDetails details;
        uint256 listingId;
        RentalStatus status;
    }

    // state variables
    uint256 public totalNumRental = 0; // used as counter
    mapping(uint256 => Rental) public rentals;
    address public listingManager;
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

    // functions
    constructor() {}

    function setListingManager(address _listingManager) external onlyOwner {
        listingManager = _listingManager;
    }

    function setVault(address _vault) external onlyOwner {
        vault = payable(_vault);
    }


    /// @dev Accept a listing, send native tokens to the vault and receive the NFT from user.
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
        ) = ListingManager(listingManager).listings(_listingId);
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
        rentals[totalNumRental] = Rental(totalNumRental, 
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
        emit RentalCreated(listingCreator, msg.sender, totalNumRental, rentals[totalNumRental]);
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
        Rental storage rental = rentals[_rentalId];
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
        uint256 refundIfProRated = 0;
        uint256 maxRentPrice = PriceCalculator.calculateRentPrice(
            rental.details.startingDate,
            rental.details.endingDate,
            rental.details.pricePerDay,
            false // always set isProRated to false to force calculation for the full time
        );
        if (rental.details.isProRated) {
            uint256 priceProRated = PriceCalculator.calculateRentPrice(
                rental.details.startingDate,
                block.timestamp,
                rental.details.pricePerDay,
                true
            );
            refundIfProRated = maxRentPrice - priceProRated;
        }
        Vault(vault).increaseOwnerBalance(rental.details.initialOwner, maxRentPrice - refundIfProRated);
        Vault(vault).returnCollateral(rental.details.renter, rental.details.collateralAmount + refundIfProRated);
        emit RentalRefunded(rental.details.initialOwner, msg.sender, rental.rentalId, rental);
    }

    /// @dev This method can be used by the original owner if the renter didn't come back with the NFT.
    /// @param _rentalId Id of the rental
    function liquidateRental(uint256 _rentalId) external {
        Rental storage rental = rentals[_rentalId];
        require(rental.details.initialOwner == msg.sender, "Not allowed to liquidate");
        require(
            rental.status == RentalStatus.EXPIRED || 
            (block.timestamp > rental.details.endingDate && rental.status == RentalStatus.ACTIVE), 
            "Rental invalid"
        );
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

    // chainlink monitoring
    // -> monitor timestamps of listing, proposal and rental
    // -> monitor collateral amount during rental
}