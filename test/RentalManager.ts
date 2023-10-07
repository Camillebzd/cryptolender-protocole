import { expect } from "chai";
import { ethers } from "hardhat";
import { ListingManager, ProposalManager } from "../typechain-types";
import {
    loadFixture,
    time
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { EventLog } from "ethers"

enum ListingStatus {
    UNSET,
    PENDING, 
    COMPLETED, 
    CANCELLED
};

enum ProposalStatus {
    UNSET,
    PENDING,
    ACCEPTED,
    REFUSED,
    CANCELLED
};

enum RentalStatus {
    UNSET,
    ACTIVE,
    EXPIRED,
    REFUND,
    LIQUIDATED
}

describe('RentalManager', function () {
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

        return {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, commissionRate
        };
    }

    it("Should create a rental and emit creation rental event", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // Check event data
        expect(eventLogRent.fragment.name).to.equal("RentalCreated");
        expect(eventLogRent.args[0]).to.equal(firstUser.address); // owner
        expect(eventLogRent.args[1]).to.equal(secondUser.address); // renter
        const rentalValues = eventLogRent.args[3]; // rental value in an array ordered
        expect(Number(rentalValues[0])).to.equal(rentalId);
        expect(rentalValues[1][0]).to.equal(firstUser.address);
        expect(rentalValues[1][1]).to.equal(secondUser.address);
        expect(rentalValues[1][2]).to.equal(listing.assetContract);
        expect(Number(rentalValues[1][3])).to.equal(listing.tokenId);
        expect(Number(rentalValues[1][4])).to.equal(listing.collateralAmount);
        expect(Number(rentalValues[1][5])).to.equal(listing.pricePerDay);
        // how to determine that ? -> force time with hardhat
        // expect(Number(rentalValues[1][6])).to.equal((new Date()).getTime());
        expect(Number(rentalValues[1][7])).to.equal(proposal.endTimestampRental);
        expect(rentalValues[1][8]).to.equal(proposal.isProRated);
        expect(rentalValues[2][0]).to.equal(listingId);
        expect(rentalValues[2][1]).to.equal(propId);

        // Check data in storage
        const newRental = await rentalManagerFirstUser.rentalIdToRental(rentalId);
        expect(newRental.details.owner).to.equal(firstUser.address);
        expect(newRental.details.renter).to.equal(secondUser.address);
        expect(newRental.details.assetContract).to.equal(listing.assetContract);
        expect(newRental.details.tokenId).to.equal(listing.tokenId);
        expect(newRental.details.collateralAmount).to.equal(listing.collateralAmount);
        expect(newRental.details.pricePerDay).to.equal(listing.pricePerDay);
        // handle this
        // expect(newRental.details.startingDate).to.equal();
        expect(newRental.details.endingDate).to.equal(proposal.endTimestampRental);
        expect(newRental.details.isProRated).to.equal(proposal.isProRated);
        expect(newRental.info.listingId).to.equal(listingId);
        expect(newRental.info.proposalId).to.equal(propId);

        // check listing and proposal states
        expect((await listingManagerFirstUser.listingIdToListing(listingId)).status).to.equal(ListingStatus.COMPLETED);
        expect((await proposalManagerFirstUser.proposalIdToProposal(propId)).status).to.equal(ProposalStatus.ACCEPTED);
    });

    it("Should give the nft to renter and collateral to escrow", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // check before rent
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(firstUser.address);
        expect(await myToken20SecondUser.balanceOf(escrow.getAddress())).to.equal(0);
        expect(await myToken20SecondUser.balanceOf(secondUser.address)).to.equal(collateralAmount);

        // accept proposal and create rental
        await proposalManagerFirstUser.acceptProposal(propId);

        // check after rental creation
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(secondUser.address);
        expect(await myToken20SecondUser.balanceOf(escrow.getAddress())).to.equal(collateralAmount);
        expect(await myToken20SecondUser.balanceOf(secondUser.address)).to.equal(0);
    });

    it("Should revert if trying to accept a cancelled listing", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // cancel listing before accept
        await listingManagerFirstUser.cancelListing(listingId);
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.revertedWith("Listing invalid");
    });

    it("Should revert if trying to accept a cancelled proposal", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // cancel proposal before accept
        await proposalManagerSecondUser.cancelProposal(propId);
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.revertedWith("Proposal invalid");
    });

    it("Should revert if trying to accept a proposal without owning the listing", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // secondUser accept his own proposal
        await expect(proposalManagerSecondUser.acceptProposal(propId)).to.revertedWith("Not allowed to accept this proposal");
    });

    it("Should revert if trying to accept 2 times the same proposal or accept 2 proposals on the same listing", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // create second proposal
        const txProp2 = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp2 = (await txProp2.wait())?.logs[0] as EventLog;
        const propId2 = Number(eventLogProp2.args[1]);


        await proposalManagerFirstUser.acceptProposal(propId);
        // try to accept 2 times the same proposal
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.be.revertedWith("Proposal invalid");
        // try to accept a second proposal of the same listing
        await expect(proposalManagerFirstUser.acceptProposal(propId2)).to.be.revertedWith("Listing invalid");
    });

    it("Should revert if trying to accept proposal and approves on nft or collateral are removed", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // remove nft approve
        await myToken721FirstUser.setApprovalForAll(escrow.getAddress(), false);
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.be.revertedWith("Escrow contract is not approved to transfer this nft");
        await myToken721FirstUser.setApprovalForAll(escrow.getAddress(), true);

        // remove collateral amount
        await myToken20SecondUser.approve(escrow.getAddress(), 0);
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
    });

    it("Should revert if trying to accept proposal and timestamps are bad", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // Listing expired
        await time.setNextBlockTimestamp(Number(listing.endTimestamp) + 1); // increase time
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.be.revertedWith("Listing expired");

        // Proposal expired
        await listingManagerFirstUser.updateListing(listingId, {...listing, endTimestamp: Number(proposal.endTimestampRental) + 10});
        await time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1); // increase time
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.be.revertedWith("Proposal expired");
        // Proposal expired 
        await proposalManagerSecondUser.updateProposal(propId, {...proposal, endTimestampProposal: Number(proposal.endTimestampProposal) + 10});
        await time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 3); // increase time
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.be.revertedWith("Proposal expired");
    });

    it("Should revert if trying to accept proposal and you don't own the nft anymore", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // transfer the nft so you don't own it anymore
        await myToken721FirstUser.transferFrom(firstUser.address, secondUser.address, 0);
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.revertedWith("You are not the owner of the nft");
    });

    it("Should revert if trying to accept proposal and renter doesn't have enough founds", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // transfer some founds so secondUser doesn't have enough for collateral
        await myToken20SecondUser.transfer(firstUser.address, 20);
        await expect(proposalManagerFirstUser.acceptProposal(propId)).to.revertedWith("Not enough token balance to cover the collateral");
    });

    it("Should refund the NFT, retreive collateral, owner balance increase and escrow own the nft (no pro-rated)", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, commissionRate
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // change time and calcul price
        const lastBlockTimestamp = (await ethers.provider.getBlock("latest"))?.date as Date;
        // simulate time change in blockchain
        const days = 5;
        let timeAddedTimestamp = new Date(lastBlockTimestamp);
        timeAddedTimestamp.setDate(timeAddedTimestamp.getDate() + days);
        time.setNextBlockTimestamp(timeAddedTimestamp);
        // calculate days between start and end proposal non pro raited
        const totalDays = Math.ceil((Number(proposal.endTimestampRental) - Number(lastBlockTimestamp)) / (1000 * 3600 * 24));
        const pricePaied = totalDays * Number(listing.pricePerDay);
        const commission = commissionRate * pricePaied / 100;

        // approve the contract
        myToken721SecondUser.setApprovalForAll(await escrow.getAddress(), true);

        // return the nft and retreive collateral
        await expect(rentalManagerSecondUser.refundRental(rentalId)).to.emit(rentalManagerSecondUser, "RentalRefunded");

        // user retreive collateral minus paied commission and rental
        expect(await myToken20SecondUser.balanceOf(secondUser)).to.equal(Number(listing.collateralAmount) - pricePaied - commission);
        // escrow own the nft and owner balance increased
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(await escrow.getAddress());
        expect(await escrow.ownerBalance(firstUser.address, await myToken20SecondUser.getAddress())).to.equal(pricePaied);
        // check rental state
        expect((await rentalManagerFirstUser.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
    });

    it("Should refund the NFT, retreive collateral, owner balance increase and escrow own the nft (pro-rated)", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, commissionRate
        } = await loadFixture(deployFixture);

        // update proposal to pro rated
        await proposalManagerSecondUser.updateProposal(propId, {...proposal, isProRated: true});

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // change time and calcul price
        const lastBlockTimestampStartRental = (await ethers.provider.getBlock("latest"))?.date as Date;
        // simulate time change in blockchain
        const days = 4;
        let timeAddedTimestamp = new Date(lastBlockTimestampStartRental);
        timeAddedTimestamp.setDate(timeAddedTimestamp.getDate() + days);
        time.setNextBlockTimestamp(timeAddedTimestamp);

        // approve the contract
        myToken721SecondUser.setApprovalForAll(await escrow.getAddress(), true);

        // return the nft and retreive collateral
        await expect(rentalManagerSecondUser.refundRental(rentalId)).to.emit(rentalManagerSecondUser, "RentalRefunded");

        // calculate the rest after refundRental to be sure about execution time
        const lastBlockTimestampRefundRental = (await ethers.provider.getBlock("latest"))?.date as Date;
        const totalDays = Math.ceil(Number(lastBlockTimestampRefundRental.getTime() - lastBlockTimestampStartRental.getTime()) / (1000 * 3600 * 24));
        const pricePaied = totalDays * Number(listing.pricePerDay);
        const commission = commissionRate * pricePaied / 100;

        // user retreive collateral minus paied commission and rental
        expect(await myToken20SecondUser.balanceOf(secondUser)).to.equal(Number(listing.collateralAmount) - pricePaied - commission);
        // escrow own the nft and owner balance increased
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(await escrow.getAddress());
        expect(await escrow.ownerBalance(firstUser.address, await myToken20SecondUser.getAddress())).to.equal(pricePaied);
        // check rental state
        expect((await rentalManagerFirstUser.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
    });

    it("Should refund the NFT, retreive collateral, owner balance increase and escrow own the nft (no pro-rated, 30mins after)", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, commissionRate
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // change time and calcul price
        const lastBlockTimestamp = (await ethers.provider.getBlock("latest"))?.date as Date;
        // simulate time change in blockchain
        const minutes = 30;
        let timeAddedTimestamp = new Date(lastBlockTimestamp);
        timeAddedTimestamp.setMinutes(timeAddedTimestamp.getMinutes() + minutes);
        time.setNextBlockTimestamp(timeAddedTimestamp);
        // calculate days between start and end proposal non pro raited
        const totalDays = Math.ceil((Number(proposal.endTimestampRental) - Number(lastBlockTimestamp)) / (1000 * 3600 * 24));
        const pricePaied = totalDays * Number(listing.pricePerDay);
        const commission = commissionRate * pricePaied / 100;

        // approve the contract
        myToken721SecondUser.setApprovalForAll(await escrow.getAddress(), true);

        // return the nft and retreive collateral
        await expect(rentalManagerSecondUser.refundRental(rentalId)).to.emit(rentalManagerSecondUser, "RentalRefunded");

        // user retreive collateral minus paied commission and rental
        expect(await myToken20SecondUser.balanceOf(secondUser)).to.equal(Number(listing.collateralAmount) - pricePaied - commission);
        // escrow own the nft and owner balance increased
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(await escrow.getAddress());
        expect(await escrow.ownerBalance(firstUser.address, await myToken20SecondUser.getAddress())).to.equal(pricePaied);
        // check rental state
        expect((await rentalManagerFirstUser.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
    });

    it("Should refund the NFT, retreive collateral, owner balance increase and escrow own the nft (pro-rated 30, min after)", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId, commissionRate
        } = await loadFixture(deployFixture);

        // update proposal to pro rated
        await proposalManagerSecondUser.updateProposal(propId, {...proposal, isProRated: true});

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // change time and calcul price
        const lastBlockTimestampStartRental = (await ethers.provider.getBlock("latest"))?.date as Date;
        // simulate time change in blockchain
        const minutes = 30;
        let timeAddedTimestamp = new Date(lastBlockTimestampStartRental);
        timeAddedTimestamp.setMinutes(timeAddedTimestamp.getMinutes() + minutes);
        time.setNextBlockTimestamp(timeAddedTimestamp);

        // approve the contract
        myToken721SecondUser.setApprovalForAll(await escrow.getAddress(), true);

        // return the nft and retreive collateral
        await expect(rentalManagerSecondUser.refundRental(rentalId)).to.emit(rentalManagerSecondUser, "RentalRefunded");

        // calculate the rest after refundRental to be sure about execution time
        const lastBlockTimestampRefundRental = (await ethers.provider.getBlock("latest"))?.date as Date;
        const totalDays = Math.ceil(Number(lastBlockTimestampRefundRental.getTime() - lastBlockTimestampStartRental.getTime()) / (1000 * 3600 * 24));
        expect(totalDays).to.equal(1); // because even if you keep it 30mins you pay at least a complet day
        const pricePaied = totalDays * Number(listing.pricePerDay);
        const commission = commissionRate * pricePaied / 100;

        // user retreive collateral minus paied commission and rental
        expect(await myToken20SecondUser.balanceOf(secondUser)).to.equal(Number(listing.collateralAmount) - pricePaied - commission);
        // escrow own the nft and owner balance increased
        expect(await myToken721FirstUser.ownerOf(listing.tokenId)).to.equal(await escrow.getAddress());
        expect(await escrow.ownerBalance(firstUser.address, await myToken20SecondUser.getAddress())).to.equal(pricePaied);
        // check rental state
        expect((await rentalManagerFirstUser.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
    });

    // is it a good behavior ? Do we want this ?
    it("Should revert if refund while not be renter even if owning the nft", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // renter send the nft to other user
        myToken721SecondUser.transferFrom(secondUser.address, firstUser.address, listing.tokenId);
        
        // the other user try to refund the rental
        await myToken721FirstUser.setApprovalForAll(await escrow.getAddress(), true);
        await expect(rentalManagerFirstUser.refundRental(rentalId)).to.revertedWith("Not allowed to renfund");
    });

    it("Should revert if refund and no approve set from renter to escrow", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // refund without setApproval to escrow
        await expect(rentalManagerSecondUser.refundRental(rentalId)).to.revertedWith("Escrow contract is not approved to transfer this nft");
    });

    it("Should revert if refund without owning the nft anymore", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // renter send the nft to somebody else
        await myToken721SecondUser.transferFrom(secondUser.address, firstUser.address, listing.tokenId);
        await myToken721SecondUser.setApprovalForAll(await escrow.getAddress(), true);
        await expect(rentalManagerSecondUser.refundRental(rentalId)).to.revertedWith("You are not the owner of the nft");
    });

    it("Should revert if refund an invalid rental", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);
        
        // approve the contract
        myToken721SecondUser.setApprovalForAll(await escrow.getAddress(), true);

        await expect(rentalManagerSecondUser.refundRental(rentalId + 1)).to.reverted;
    });

    it("Should be able to liquidate a non refunded rental and expired", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, 
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // advance time after the end of rental
        time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1);

        await expect(rentalManagerFirstUser.liquidateRental(rentalId)).to.emit(rentalManagerFirstUser, "RentalLiquidated");
        // check rental state
        expect((await rentalManagerFirstUser.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.LIQUIDATED);
        // check liquidation amount
        expect(await myToken20SecondUser.balanceOf(firstUser.address)).to.equal(listing.collateralAmount);
    });

    it("Should revert if trying to liquidate a refunded rental", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

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
        
        // advance time after the end of rental
        time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1);
        await expect(rentalManagerFirstUser.liquidateRental(rentalId)).to.revertedWith("Rental invalid");
    });

    it("Should revert if trying to liquidate a non ended rental", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // advance time just before the end of rental
        time.setNextBlockTimestamp(Number(proposal.endTimestampRental) - 1);

        await expect(rentalManagerFirstUser.liquidateRental(rentalId)).to.revertedWith("Rental invalid");
    });

    it("Should revert if trying to liquidate an expired rental but not owned", async function () {
        const {
            firstUser, secondUser, listingManagerFirstUser, proposalManagerFirstUser, proposalManagerSecondUser, 
            rentalManagerFirstUser, rentalManagerSecondUser, escrow, myToken721FirstUser, myToken721SecondUser,
            myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount,
            listingId, propId
        } = await loadFixture(deployFixture);

        // accept proposal and create rental
        const txRental = await proposalManagerFirstUser.acceptProposal(propId);
        const rentalReceipt = await txRental.wait();
        const events = await rentalManagerFirstUser.queryFilter(rentalManagerFirstUser.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);

        // advance time just before the end of rental
        time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1);

        await expect(rentalManagerSecondUser.liquidateRental(rentalId)).to.revertedWith("Not allowed to liquidate");
    });
});