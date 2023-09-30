import { expect } from "chai";
import { ethers } from "hardhat";
import { ListingManager, ProposalManager } from "../typechain-types";
import {
    loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { EventLog } from "ethers"

enum ProposalStatus {
    UNSET,
    PENDING,
    ACCEPTED,
    REFUSED,
    CANCELLED
};

describe('ProposalManager', function () {
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
        await listingManager.setEscrow(escrow.getAddress());
        const listingManagerFirstUser = listingManager.connect(firstUser);
        // first user approve the escrow on nft contract
        const myToken721FirstUser = myToken721.connect(firstUser);
        await myToken721FirstUser.setApprovalForAll(escrow.getAddress(), true);
        // second user approve the escrow on erc20 contract
        const myToken20SecondUser = myToken20.connect(secondUser);
        myToken20SecondUser.approve(escrow.getAddress(), collateralAmount);
        // ProposalManager contract
        const ProposalManager = await ethers.getContractFactory("ProposalManager");
        const proposalManager = await ProposalManager.deploy();
        await proposalManager.setEscrow(escrow.getAddress());
        await proposalManager.setListingManager(listingManagerFirstUser.getAddress());
        await proposalManager.setERC20(myToken20.getAddress());
        const proposalManagerSecondUser = proposalManager.connect(secondUser);
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

        return { firstUser, secondUser, listingManagerFirstUser, proposalManagerSecondUser, escrow, myToken721FirstUser, myToken20SecondUser, listing, listingUpdating, proposal, proposalUpdating, collateralAmount, listingId };
    }

    it("Should create a proposal and emit event creation", async function () {
        const { secondUser, proposalManagerSecondUser, proposal, listingId } = await loadFixture(deployFixture);

        // create new proposal
        // TODO retreive event manually then check it
        await expect(proposalManagerSecondUser.createProposal(listingId, proposal)).to.emit(proposalManagerSecondUser, "ProposalCreated");
        const proposalCreated = await proposalManagerSecondUser.proposalIdToProposal(0); // hard coded
        expect(proposalCreated.listingId).to.equal(listingId);
        expect(proposalCreated.proposalCreator).to.equal(secondUser.address);
        expect(Number(proposalCreated.startTimestampProposal)).to.equal(Number(proposal.startTimestampProposal));
        expect(Number(proposalCreated.endTimestampProposal)).to.equal(Number(proposal.endTimestampProposal));
        expect(Number(proposalCreated.endTimestampRental)).to.equal(Number(proposal.endTimestampRental));
        expect(proposalCreated.isProRated).to.equal(proposal.isProRated);
        expect(proposalCreated.status).to.equal(ProposalStatus.PENDING);
    });

    it("Should revert if proposal whitout approve collateral amount", async function () {
        const { proposalManagerSecondUser, escrow, myToken20SecondUser, proposal, collateralAmount, listingId } = await loadFixture(deployFixture);

        // remove allowance
        await myToken20SecondUser.approve(escrow.getAddress(), 0);
        // Create proposal when escrow doesn't have collateral approved
        await expect(proposalManagerSecondUser.createProposal(listingId, proposal)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
        // give not enough allowance
        await myToken20SecondUser.approve(escrow.getAddress(), collateralAmount - 1);
        await expect(proposalManagerSecondUser.createProposal(listingId, proposal)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
    });

    it("Should revert if proposal whit enough approved collateral amount but not enough balance", async function () {
        const { proposalManagerSecondUser, escrow, myToken20SecondUser, proposal, listingId } = await loadFixture(deployFixture);

        // Decreases balance so don't have enough to use as collateral
        await myToken20SecondUser.transfer(await escrow.getAddress(), 20);
        await expect(proposalManagerSecondUser.createProposal(listingId, proposal)).to.revertedWith("Not enough token balance to cover the collateral");
    });

    it("Should revert if proposal on non existant listing", async function () {
        const { proposalManagerSecondUser, proposal, listingId } = await loadFixture(deployFixture);

        // Create proposal on non existant listing
        await expect(proposalManagerSecondUser.createProposal(listingId + 1, proposal)).to.be.revertedWith("Listing invalid");
    });

    it("Should revert if proposal on a cancelled listing", async function () {
        const { listingManagerFirstUser, proposalManagerSecondUser, proposal, listingId } = await loadFixture(deployFixture);

        // Cancel listing
        await listingManagerFirstUser.cancelListing(listingId);
        await expect(proposalManagerSecondUser.createProposal(listingId + 1, proposal)).to.be.revertedWith("Listing invalid");
    });


    it("Should revert if proposal timestamp are incorrect", async function () {
        const { proposalManagerSecondUser, listing, proposal, listingId } = await loadFixture(deployFixture);

        // startTimestampProposal before the listing Date
        let faillingProposal: ProposalManager.ProposalParametersStruct = {...proposal, startTimestampProposal: Number(listing.startTimestamp) - 100};
        await expect(proposalManagerSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(proposalManagerSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(proposalManagerSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampProposal after listing endTimestamp
        faillingProposal = {...proposal, startTimestampProposal: Number(listing.endTimestamp) + 100};
        await expect(proposalManagerSecondUser.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");
    });

    it("Should update a proposal and emit update event", async function () {
        const { secondUser, proposalManagerSecondUser, proposal, proposalUpdating, listingId } = await loadFixture(deployFixture);

        // create new proposal
        const txProp = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        await expect(proposalManagerSecondUser.updateProposal(propId, proposalUpdating)).to.emit(proposalManagerSecondUser, "ProposalUpdated");
        const updatedProposal = await proposalManagerSecondUser.proposalIdToProposal(propId);
        expect(updatedProposal.listingId).to.equal(propId);
        expect(updatedProposal.proposalCreator).to.equal(secondUser.address);
        expect(Number(updatedProposal.startTimestampProposal)).to.equal(Number(proposalUpdating.startTimestampProposal));
        expect(Number(updatedProposal.endTimestampProposal)).to.equal(Number(proposalUpdating.endTimestampProposal));
        expect(Number(updatedProposal.endTimestampRental)).to.equal(Number(proposalUpdating.endTimestampRental));
        expect(updatedProposal.isProRated).to.equal(proposalUpdating.isProRated);
        expect(updatedProposal.status).to.equal(ProposalStatus.PENDING);
    });

    it("Should revert if updating a non existant proposal", async function () {
        const { proposalManagerSecondUser, proposal, proposalUpdating, listingId } = await loadFixture(deployFixture);

        // create new proposal
        const txProp = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        await expect(proposalManagerSecondUser.updateProposal(propId + 1, proposalUpdating)).to.be.reverted;
    });

    it("Should revert if updating a proposal with bad timestamp", async function () {
        const { proposalManagerSecondUser, listing, proposal, listingId } = await loadFixture(deployFixture);

        // create new proposal
        const txProp = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        // Testing bad timestamps for update
        // startTimestampProposal before the listing Date
        let faillingProposal: ProposalManager.ProposalParametersStruct = {...proposal, startTimestampProposal: Number(listing.startTimestamp) - 100};
        await expect(proposalManagerSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(proposalManagerSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(proposalManagerSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampProposal after listing endTimestamp
        faillingProposal = {...proposal, startTimestampProposal: Number(listing.endTimestamp) + 100};
        await expect(proposalManagerSecondUser.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");
    });

    it("Should revert if updating a non ownerd proposal", async function () {
        const { firstUser, proposalManagerSecondUser, proposal, proposalUpdating, listingId } = await loadFixture(deployFixture);

        // create new proposal
        const txProp = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        // connect first user to test updating with it
        const proposalManagerFirstUser = proposalManagerSecondUser.connect(firstUser);
        await expect(proposalManagerFirstUser.updateProposal(propId, proposalUpdating)).to.be.revertedWith("Error: you are not the owner of the proposal");
    });

    it("Should be able to cancel a proposal and emit cancel event", async function () {
        const { proposalManagerSecondUser, proposal, listingId } = await loadFixture(deployFixture);

        // create new proposal
        const txProp = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        // cancel proposal
        await expect(proposalManagerSecondUser.cancelProposal(propId)).to.emit(proposalManagerSecondUser, "ProposalCancelled");
        const canceledProposal = await proposalManagerSecondUser.proposalIdToProposal(propId);
        expect(canceledProposal.status).to.equal(ProposalStatus.CANCELLED);
    });

    it("Should revert if trying to cancel a cancelled  proposal", async function () {
        const { proposalManagerSecondUser, proposal, listingId } = await loadFixture(deployFixture);

        // create new proposal
        const txProp = await proposalManagerSecondUser.createProposal(listingId, proposal);
        const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
        const propId = Number(eventLogProp.args[1]);

        // cancel proposal
        await proposalManagerSecondUser.cancelProposal(propId);
        // cancel same proposal
        await expect(proposalManagerSecondUser.cancelProposal(propId)).to.be.revertedWith("Proposal invalid");
    });
});