import { expect } from "chai";
import { ethers } from "hardhat";
import { ListingManager, ProposalManager } from "../typechain-types";
import {
    loadFixture,
    time
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { EventLog } from "ethers"

describe('Escrow', function () {
    async function deployFixture() {
        const [ owner, firstUser, secondUser ] = await ethers.getSigners();
        const collateralAmount = 40000;
        const commissionRate = 5;
        // Classic ERC721 contract
        const MyToken721 = await ethers.getContractFactory("MyToken721");
        const myToken721 = await MyToken721.deploy();
        await myToken721.safeMint(firstUser.address, 0); // first token for firstUser
        await myToken721.safeMint(owner.address, 1); // some token for owner
        await myToken721.safeMint(owner.address, 2); // some token for owner
        // Classic ERC20 contract
        const MyToken20 = await ethers.getContractFactory("MyToken20");
        const myToken20 = await MyToken20.deploy();
        await myToken20.mint(secondUser.address, collateralAmount); // give to second user exact amount for collateral
        // Escrow contract
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy();
        const escrowFirstUser = escrow.connect(firstUser);
        // ListingManager contract
        const ListingManager = await ethers.getContractFactory("ListingManager");
        const listingManager = await ListingManager.deploy();
        const listingManagerFirstUser = listingManager.connect(firstUser);
        // first user approve the escrow on nft contract
        const myToken721FirstUser = myToken721.connect(firstUser);
        const myToken721SecondUser = myToken721.connect(secondUser);
        await myToken721FirstUser.setApprovalForAll(escrow.getAddress(), true);
        // second user approve the escrow on erc20 contract
        const myToken20SecondUser = myToken20.connect(secondUser);
        myToken20SecondUser.approve(escrow.getAddress(), collateralAmount);
        // ProposalManager contract
        const ProposalManager = await ethers.getContractFactory("ProposalManager");
        const proposalManager = await ProposalManager.deploy();
        const proposalManagerFirstUser = proposalManager.connect(firstUser);
        const proposalManagerSecondUser = proposalManager.connect(secondUser);
        // RentalManager
        const RentalManager = await ethers.getContractFactory("RentalManager");
        const rentalManager = await RentalManager.deploy();
        const rentalManagerFirstUser = rentalManager.connect(firstUser);
        const rentalManagerSecondUser = rentalManager.connect(secondUser);
        // set up contracts
        await listingManager.setEscrow(escrow.getAddress());
        await listingManager.setProposalManager(proposalManager.getAddress());
        await listingManager.setRentalManager(rentalManager.getAddress());
        await proposalManager.setEscrow(escrow.getAddress());
        await proposalManager.setListingManager(listingManagerFirstUser.getAddress());
        await proposalManager.setERC20(myToken20.getAddress());
        await proposalManager.setRentalManager(rentalManager.getAddress());
        await rentalManager.setEscrow(escrow.getAddress());
        await rentalManager.setListingManager(listingManagerFirstUser.getAddress());
        await rentalManager.setERC20(myToken20.getAddress());
        await rentalManager.setProposalManager(proposalManager.getAddress());
        await escrow.setRentalManager(rentalManager.getAddress());
        await escrow.setCommissionRate(commissionRate);

        // Usefull data
        const listing: ListingManager.ListingParametersStruct = {
            assetContract: await myToken721.getAddress(),
            tokenId: 0,
            collateralAmount: collateralAmount,
            startTimestamp: Date.now(),
            endTimestamp: new Date().setDate(new Date().getDate() + 7),
            pricePerDay: 300,
            comment: "No comment"
        };
        const listingUpdating: ListingManager.ListingParametersStruct = {
            assetContract: await myToken721.getAddress(),
            tokenId: 0,
            collateralAmount: collateralAmount,
            startTimestamp: Date.now(),
            endTimestamp: new Date().setDate(new Date().getDate() + 7),
            pricePerDay: 100,
            comment: "No comment but updated"
        };
        const proposal: ProposalManager.ProposalParametersStruct = {
            startTimestampProposal: Date.now(),
            endTimestampProposal: new Date().setDate(new Date().getDate() + 7),
            endTimestampRental: new Date().setDate(new Date().getDate() + 9),
            isProRated: false
        }
        const proposalUpdating: ProposalManager.ProposalParametersStruct = {
            startTimestampProposal: new Date().setDate(new Date().getDate() + 1),
            endTimestampProposal: new Date().setDate(new Date().getDate() + 8),
            endTimestampRental: new Date().setDate(new Date().getDate() + 9),
            isProRated: true
        }

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // create new proposal
        const txProp = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // approve the contract
        myToken721SecondUser.setApprovalForAll(await escrow.getAddress(), true);

        // return the nft and retreive collateral
        await expect(rentalManagerSecondUser.refundRental(rentalId)).to.emit(rentalManagerSecondUser, "RentalRefunded");

        return {
            owner, firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        };
    }

    it("Should allow the owner to retreive his NFT after refund", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        // owner comes and retreive NFT
        await escrowFirstUser.retreiveNFT(listing.assetContract, listing.tokenId);
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(firstUser.address);
    });

    it("Should revert if other than owner try to retreive NFT after refund", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        // owner comes and retreive NFT
        await expect(escrow.connect(secondUser).retreiveNFT(listing.assetContract, listing.tokenId)).to.revertedWith("Not owner of this token");
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(await escrow.getAddress());
    });

    it("Should revert owner try to retreive a non existant NFT", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        // owner comes and retreive wrong NFT
        await expect(escrowFirstUser.retreiveNFT(listing.assetContract, Number(listing.tokenId) + 1)).to.reverted;
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(await escrow.getAddress());
    });

    it("Should revert if somebody try to use methods only for protocole", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        await expect(escrowFirstUser.transferNFTFrom(await myToken721FirstUser.getAddress(), await escrow.getAddress(), firstUser.address, listing.tokenId)).to.revertedWith("Only rentalManager is allowed to call");
        await expect(escrowFirstUser.safeTransferCollateralFrom(await myToken20SecondUser.getAddress(), await escrow.getAddress(), firstUser.address, listing.collateralAmount)).to.revertedWith("Only rentalManager is allowed to call");
        await expect(escrowFirstUser.safeTransferToRenter(firstUser.address, secondUser.address, await myToken721FirstUser.getAddress(), listing.tokenId)).to.revertedWith("Only rentalManager is allowed to call");
        await expect(escrowFirstUser.payAndReturnCollateral(await myToken20SecondUser.getAddress(), firstUser.address, listing.collateralAmount, secondUser.address, 0)).to.revertedWith("Only rentalManager is allowed to call");
        await expect(escrowFirstUser.liquidateCollateral(await myToken20SecondUser.getAddress(), firstUser.address, listing.collateralAmount)).to.revertedWith("Only rentalManager is allowed to call");
    });


    it("Should withdraw balance after a rent", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        // renter withdraw balance and receive money paied by the renter
        expect(await myToken20SecondUser.balanceOf(firstUser.address)).to.equal(0);
        await expect(escrowFirstUser.withdrawBalance(await myToken20SecondUser.getAddress())).to.emit(escrowFirstUser, "BalanceWithdrawed");
        expect(await myToken20SecondUser.balanceOf(firstUser.address)).to.be.greaterThan(0);
    });

    it("Should revert if withdrawing empty balance", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        // withdraw so no more money in balance
        await expect(escrowFirstUser.withdrawBalance(await myToken20SecondUser.getAddress())).to.emit(escrowFirstUser, "BalanceWithdrawed");

        await expect(escrowFirstUser.withdrawBalance(await myToken20SecondUser.getAddress())).to.revertedWith("Not enough found");
    });

    it("Should allow deployer to withdraw protocole founds", async function () {
        const {
            owner, firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        // deployer founds empty before withdraw
        expect(await myToken20SecondUser.balanceOf(owner.address)).to.equal(0);
        await expect(escrow.withdrawProtocoleBalance(await myToken20SecondUser.getAddress())).to.emit(escrow, "BalanceWithdrawed");
        expect(await myToken20SecondUser.balanceOf(owner.address)).to.be.greaterThan(0);
    });    

    it("Should revert if withdrawing protocole balance without being deployer", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, escrowFirstUser, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, rentalId, commissionRate
        } = await loadFixture(deployFixture);

        // NFT owner try to withdraw protocole balance
        await expect(escrowFirstUser.withdrawProtocoleBalance(await myToken20SecondUser.getAddress())).to.revertedWith("Ownable: caller is not the owner");
    });

});