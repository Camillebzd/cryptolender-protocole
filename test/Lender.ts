import { expect } from "chai";
import { ethers } from "hardhat";
import { Lender } from "../typechain-types";
import {
    loadFixture
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
}

describe('Lender', function () {
    async function deployFixture() {
        const [ owner, secondUser ] = await ethers.getSigners();
        const collateralAmount = 40000;
        // Classic ERC721 contract
        const MyToken721 = await ethers.getContractFactory("MyToken721");
        const myToken721 = await MyToken721.deploy();
        await myToken721.safeMint(owner.address, 0);
        // Classic ERC20 contract
        const MyToken20 = await ethers.getContractFactory("MyToken20");
        const myToken20 = await MyToken20.deploy();
        await myToken20.mint(secondUser.address, collateralAmount);
        const myToken20SecondUser = myToken20.connect(secondUser);
        // Lender contract
        const Lender = await ethers.getContractFactory("Lender");
        const lender = await Lender.deploy(await myToken20.getAddress());
        const lenderSecondUser = lender.connect(secondUser);
        // first approve the nft contract
        await myToken721.setApprovalForAll(lender.getAddress(), true);
        // second approve the collateral
        await myToken20SecondUser.approve(lender.getAddress(), collateralAmount);
        // Usefull data
        let date = new Date();
        date.setDate(date.getDate() + 7);
        const listing: Lender.ListingParametersStruct = {
            assetContract: await myToken721.getAddress(),
            tokenId: 0,
            collateralAmount: collateralAmount,
            erc20DenominationUsed: "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E",
            startTimestamp: Date.now(),
            endTimestamp: new Date().setDate(new Date().getDate() + 7),
            pricePerDay: 300,
            comment: "No comment"
        };
        const listingUpdating: Lender.ListingParametersStruct = {
            assetContract: await myToken721.getAddress(),
            tokenId: 0,
            collateralAmount: collateralAmount,
            erc20DenominationUsed: "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E",
            startTimestamp: Date.now(),
            endTimestamp: new Date().setDate(new Date().getDate() + 7),
            pricePerDay: 100,
            comment: "No comment but updated"
        };
        const proposal: Lender.ProposalParametersStruct = {
            startTimestampProposal: Date.now(),
            endTimestampProposal: new Date().setDate(new Date().getDate() + 7),
            startTimestampRental: new Date().setDate(new Date().getDate() + 2),
            endTimestampRental: new Date().setDate(new Date().getDate() + 9),
            isProRated: false
        }
        const proposalUpdating: Lender.ProposalParametersStruct = {
            startTimestampProposal: new Date().setDate(new Date().getDate() + 1),
            endTimestampProposal: new Date().setDate(new Date().getDate() + 8),
            startTimestampRental: new Date().setDate(new Date().getDate() + 7),
            endTimestampRental: new Date().setDate(new Date().getDate() + 9),
            isProRated: true
        }
        return { lender, lenderSecondUser, listing, owner, secondUser, myToken721, myToken20SecondUser, listingUpdating, proposal, proposalUpdating, collateralAmount };
    }

    it("Should create a new listing and emit the creation event", async function () {
        const { lender, listing, owner } = await loadFixture(deployFixture);

        await expect(lender.createListing(listing)).to.emit(lender, "ListingCreated");
        const newListing = await lender.listingIdToListing(0); // hard coded
        expect(newListing.listingId.toString()).to.equal("0"); // hard coded
        expect(newListing.listingCreator).to.equal(owner.address);
        expect(newListing.assetContract).to.equal(listing.assetContract);
        expect(newListing.tokenId.toString()).to.equal(listing.tokenId.toString());
        expect(newListing.collateralAmount.toString()).to.equal(listing.collateralAmount.toString());
        expect(newListing.erc20DenominationUsed).to.equal(listing.erc20DenominationUsed);
        expect(newListing.startTimestamp.toString()).to.equal(listing.startTimestamp.toString());
        expect(newListing.endTimestamp.toString()).to.equal(listing.endTimestamp.toString());
        expect(newListing.pricePerDay.toString()).to.equal(listing.pricePerDay.toString());
        expect(newListing.comment).to.equal(listing.comment);
        expect(newListing.status).to.equal(ListingStatus.PENDING);
    });

    it("Should revert if owner doesn't setApprovalForAll", async function () {
        const { lender, listing, myToken721 } = await loadFixture(deployFixture);

        // unapprove the contract
        await myToken721.setApprovalForAll(lender.getAddress(), false);

        await expect(lender.createListing(listing)).to.be.revertedWith("Escrow contract is not approved to transfer this nft");
    });

    it("Should revert if assetContract is invalid", async function () {
        const { lender, listing } = await loadFixture(deployFixture);

        const listingCopie = {...listing, assetContract: "0x0000000000000000000000000000000000000000"};
        await expect(lender.createListing(listingCopie)).to.be.revertedWith("Invalid nft contract address");
    });

    it("Should revert if timestamps is incorrect", async function () {
        const { lender, listing } = await loadFixture(deployFixture);

        let listingCopie = {...listing, endTimestamp: new Date().setDate(new Date().getDate() - 1)};
        await expect(lender.createListing(listingCopie)).to.be.revertedWith("Invalid end timestamp");
        listingCopie.startTimestamp = new Date().setDate(new Date().getDate() + 6);
        listingCopie.endTimestamp = new Date().setDate(new Date().getDate() + 4);
        await expect(lender.createListing(listingCopie)).to.be.revertedWith("Invalid end timestamp");
    });

    it("Should revert if collateral is set to 0", async function () {
        const { lender, listing } = await loadFixture(deployFixture);

        const listingCopie = {...listing, collateralAmount: 0};
        await expect(lender.createListing(listingCopie)).to.be.reverted;
    });

    it("Should revert if trying to create 2 listing of the same token", async function () {
        const { lender, listing } = await loadFixture(deployFixture);

        await lender.createListing(listing);
        await expect(lender.createListing(listing)).to.be.revertedWith("Can not create 2 listing of same NFT");
    });

    it("Should update a listing and emit event", async function () {
        const { lender, listing, listingUpdating, owner } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await (lender.updateListing(listingId, listingUpdating));
        const updatedListing = await lender.listingIdToListing(listingId);
        expect(updatedListing.listingCreator).to.equal(owner.address);
        expect(updatedListing.assetContract).to.equal(listingUpdating.assetContract);
        expect(updatedListing.tokenId.toString()).to.equal(listingUpdating.tokenId.toString());
        expect(updatedListing.collateralAmount.toString()).to.equal(listingUpdating.collateralAmount.toString());
        expect(updatedListing.erc20DenominationUsed).to.equal(listingUpdating.erc20DenominationUsed);
        expect(updatedListing.startTimestamp.toString()).to.equal(listingUpdating.startTimestamp.toString());
        expect(updatedListing.endTimestamp.toString()).to.equal(listingUpdating.endTimestamp.toString());
        expect(updatedListing.pricePerDay.toString()).to.equal(listingUpdating.pricePerDay.toString());
        expect(updatedListing.comment).to.equal(listingUpdating.comment);
        expect(updatedListing.status).to.equal(ListingStatus.PENDING);
    });

    it("Should be able to cancel a listing", async function () {
        const { lender, listing } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await lender.cancelListing(listingId);
        expect((await lender.listingIdToListing(listingId)).status).to.equal(ListingStatus.CANCELLED);
    });

    it("Should be able to recreate another listing after cancel the previous", async function () {
        const { lender, listing } = await loadFixture(deployFixture);

        let tx = await lender.createListing(listing);
        let eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        const tx2 = await lender.cancelListing(listingId);
        tx = await lender.createListing(listing);
        eventLog = (await tx.wait())?.logs[0] as EventLog;
        const secondListingId = Number(eventLog.args[2]);

        expect(listingId).not.to.be.equal(secondListingId);
    });

    it("Should revert if trying to cancel a cancelled listing", async function () {
        const { lender, listing, listingUpdating } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await lender.cancelListing(listingId);
        await expect(lender.cancelListing(listingId)).to.be.revertedWith("Listing is invalid");
    });

    it("Should revert if trying to update a cancelled listing", async function () {
        const { lender, listing, listingUpdating } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await lender.cancelListing(listingId);
        await expect(lender.updateListing(listingId, listingUpdating)).to.be.revertedWith("Listing is invalid");
    });

    it("Should revert if trying to update or cancel a listing doesn't owned", async function () {
        const { lender, listing, listingUpdating, secondUser } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        const newLender = lender.connect(secondUser);
        await expect(newLender.updateListing(listingId, listingUpdating)).to.be.revertedWith("Error: you are not the owner of the listing");
        await expect(newLender.cancelListing(listingId)).to.be.revertedWith("Error: you are not the owner of the listing");
    });

    it("Should revert if trying to update or cancel a listing non existant", async function () {
        const { lender, listing, listingUpdating } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await expect(lender.updateListing(listingId + 1, listingUpdating)).to.be.reverted;
        await expect(lender.cancelListing(listingId + 1)).to.be.reverted;
    });

    // ---------------------------------------------------------------------------------------------------------------------------------------------

    it("Should create a proposal and emit event creation", async function () {
        const { lender, lenderSecondUser, listing, proposal, secondUser } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        await expect(lenderSecondUser.createProposal(listingId, proposal)).to.emit(lenderSecondUser, "ProposalCreated");
        const proposalCreated = await lenderSecondUser.proposalIdToProposal(0); // hard coded
        expect(proposalCreated.listingId).to.equal(listingId);
        expect(proposalCreated.proposalCreator).to.equal(secondUser.address);
        expect(Number(proposalCreated.startTimestampProposal)).to.equal(Number(proposal.startTimestampProposal));
        expect(Number(proposalCreated.endTimestampProposal)).to.equal(Number(proposal.endTimestampProposal));
        expect(Number(proposalCreated.startTimestampRental)).to.equal(Number(proposal.startTimestampRental));
        expect(Number(proposalCreated.endTimestampRental)).to.equal(Number(proposal.endTimestampRental));
        expect(proposalCreated.isProRated).to.equal(proposal.isProRated);
        expect(proposalCreated.status).to.equal(ProposalStatus.PENDING);
    });

    it("Should revert if proposal whitout approve collateral amount", async function () {
        const { lender, lenderSecondUser, listing, proposal, myToken20SecondUser, collateralAmount, secondUser } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // remove allowance
        await myToken20SecondUser.approve(lender.getAddress(), 0);
        // Create proposal on non existant listing
        await expect(lenderSecondUser.createProposal(listingId, proposal)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
        // give not enough allowance
        await myToken20SecondUser.approve(lender.getAddress(), collateralAmount - 1);
        await expect(lenderSecondUser.createProposal(listingId, proposal)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
    });

    it("Should revert if proposal on non existant listing", async function () {
        const { lender, lenderSecondUser, listing, proposal, secondUser } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal on non existant listing
        await expect(lenderSecondUser.createProposal(listingId + 1, proposal)).to.be.revertedWith("Listing doesn't exist");
    });

    it("Should revert if proposal timestamp are incorrect", async function () {
        const { lender, lenderSecondUser, listing, proposal } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // startTimestampProposal before the listing Date
        let faillingProposal: Lender.ProposalParametersStruct = {...proposal, startTimestampProposal: Number(listing.startTimestamp) - 100};
        await expect(lenderSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(lenderSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampRental before the listing Date
        faillingProposal = {...proposal, startTimestampRental: Number(listing.startTimestamp) - 100};
        await expect(lenderSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampRental before startTimestampRental
        faillingProposal = {...proposal, startTimestampRental: proposal.startTimestampRental, endTimestampRental: Number(proposal.startTimestampRental) - 100};
        await expect(lenderSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(lenderSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampProposal after listing endTimestamp
        faillingProposal = {...proposal, startTimestampProposal: Number(listing.endTimestamp) + 100};
        await expect(lenderSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");
    });

    it("Should update a proposal and emit update event", async function () {
        const { lender, lenderSecondUser, listing, proposal, proposalUpdating, secondUser } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        const txProp = await lenderSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        await expect(lenderSecondUser.updateProposal(propId, proposalUpdating)).to.emit(lenderSecondUser, "ProposalUpdated");
        const updatedProposal = await lenderSecondUser.proposalIdToProposal(propId);
        expect(updatedProposal.listingId).to.equal(propId);
        expect(updatedProposal.proposalCreator).to.equal(secondUser.address);
        expect(Number(updatedProposal.startTimestampProposal)).to.equal(Number(proposalUpdating.startTimestampProposal));
        expect(Number(updatedProposal.endTimestampProposal)).to.equal(Number(proposalUpdating.endTimestampProposal));
        expect(Number(updatedProposal.startTimestampRental)).to.equal(Number(proposalUpdating.startTimestampRental));
        expect(Number(updatedProposal.endTimestampRental)).to.equal(Number(proposalUpdating.endTimestampRental));
        expect(updatedProposal.isProRated).to.equal(proposalUpdating.isProRated);
        expect(updatedProposal.status).to.equal(ProposalStatus.PENDING);
    });

    it("Should revert if updating a non existant proposal", async function () {
        const { lender, lenderSecondUser, listing, proposal, proposalUpdating } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        const txProp = await lenderSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        await expect(lenderSecondUser.updateProposal(propId + 1, proposalUpdating)).to.be.reverted;
    });

    it("Should revert if updating a proposal with bad timestamp", async function () {
        const { lender, lenderSecondUser, listing, proposal } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        const txProp = await lenderSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        // Testing bad timestamps for update
        // startTimestampProposal before the listing Date
        let faillingProposal: Lender.ProposalParametersStruct = {...proposal, startTimestampProposal: Number(listing.startTimestamp) - 100};
        await expect(lenderSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(lenderSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampRental before the listing Date
        faillingProposal = {...proposal, startTimestampRental: Number(listing.startTimestamp) - 100};
        await expect(lenderSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampRental before startTimestampRental
        faillingProposal = {...proposal, startTimestampRental: proposal.startTimestampRental, endTimestampRental: Number(proposal.startTimestampRental) - 100};
        await expect(lenderSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(lenderSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampProposal after listing endTimestamp
        faillingProposal = {...proposal, startTimestampProposal: Number(listing.endTimestamp) + 100};
        await expect(lenderSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");
    });

    it("Should revert if updating a non ownerd proposal", async function () {
        const { lender, lenderSecondUser, listing, proposal, proposalUpdating } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        const txProp = await lenderSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        await expect(lender.updateProposal(propId, proposalUpdating)).to.be.revertedWith("Error: you are not the owner of the proposal");
    });

    it("Should be able to cancel a proposal and emit cancel event", async function () {
        const { lender, lenderSecondUser, listing, proposal } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        const txProp = await lenderSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        await expect(lenderSecondUser.cancelProposal(propId)).to.emit(lenderSecondUser, "ProposalCancelled");
        const canceledProposal = await lenderSecondUser.proposalIdToProposal(propId);
        expect(canceledProposal.status).to.equal(ProposalStatus.CANCELLED);
    });

    it("Should revert if trying to cancel a cancelled  proposal", async function () {
        const { lender, lenderSecondUser, listing, proposal } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        const txProp = await lenderSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        await lenderSecondUser.cancelProposal(propId);
        await expect(lenderSecondUser.cancelProposal(propId)).to.be.revertedWith("Proposal invalid");
    });

});