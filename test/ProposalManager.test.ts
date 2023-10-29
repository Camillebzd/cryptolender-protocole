import { expect } from "chai";
import { ethers, network } from "hardhat";
import { ListingManager, ProposalManager } from "../typechain-types";
import {
    loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { EventLog } from "ethers"
import { developmentChains } from "../helper-hardhat-config";
import { Stage, setup } from "./utils/setup";

enum ProposalStatus {
    UNSET,
    PENDING,
    ACCEPTED,
    REFUSED,
    CANCELLED
};

// Only test in developmentChains env
!developmentChains.includes(network.name) ? describe.skip :
describe('ProposalManager', function () {

    describe('Setup', function () {
        it("Should create all the links", async function () {
            const { ListingManager, ProposalManager, RentalManager, Escrow } = await setup(Stage.Proposing);

            // check all the others contracts of the protocol are linked
            expect(await ProposalManager.listingManager()).to.equal(await ListingManager.getAddress());
            expect(await ProposalManager.rentalManager()).to.equal(await RentalManager.getAddress());
            expect(await ProposalManager.escrow()).to.equal(await Escrow.getAddress());
        });

        it("Lessee approve the escrow to move his NFTs", async function () {
            const { MyToken20, lessee, Escrow, collateralAmount } = await setup(Stage.Proposing);

            // check the approvement of the lessor
            expect(await MyToken20.allowance(lessee, await Escrow.getAddress())).to.be.greaterThanOrEqual(collateralAmount);
        });
    });

    describe('Proposal management', function () {
        it("Should create a proposal and emit event creation", async function () {
            const { users, lessee, proposal, ProposalManager, lessor, ListingManager, listingId } = await setup(Stage.Proposing);

            // create new proposal
            // TODO retreive event manually then check it
            await expect(users[lessee].ProposalManager.createProposal(listingId, proposal)).to.emit(ProposalManager, "ProposalCreated");
            const proposalCreated = await users[lessee].ProposalManager.proposalIdToProposal(0); // hard coded
            expect(proposalCreated.listingId).to.equal(listingId);
            expect(proposalCreated.proposalCreator).to.equal(lessee);
            expect(Number(proposalCreated.startTimestampProposal)).to.equal(Number(proposal.startTimestampProposal));
            expect(Number(proposalCreated.endTimestampProposal)).to.equal(Number(proposal.endTimestampProposal));
            expect(Number(proposalCreated.endTimestampRental)).to.equal(Number(proposal.endTimestampRental));
            expect(proposalCreated.isProRated).to.equal(proposal.isProRated);
            expect(proposalCreated.status).to.equal(ProposalStatus.PENDING);
        });

        it("Should revert if proposal whitout approve collateral amount", async function () {
            const { users, lessee, proposal, Escrow, collateralAmount, listingId } = await setup(Stage.Proposing);

            // remove allowance
            await users[lessee].MyToken20.approve(await Escrow.getAddress(), 0);
            // Create proposal when escrow doesn't have collateral approved
            await expect(users[lessee].ProposalManager.createProposal(listingId, proposal)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
            // give not enough allowance
            await users[lessee].MyToken20.approve(await Escrow.getAddress(), collateralAmount - 1);
            await expect(users[lessee].ProposalManager.createProposal(listingId, proposal)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
        });

        it("Should revert if proposal whit enough approved collateral amount but not enough balance", async function () {
            const { users, lessee, proposal, Escrow, listingId } = await setup(Stage.Proposing);

            // Decreases balance so don't have enough to use as collateral
            await users[lessee].MyToken20.transfer(await Escrow.getAddress(), Number(await users[lessee].MyToken20.balanceOf(lessee)) - 10);
            await expect(users[lessee].ProposalManager.createProposal(listingId, proposal)).to.revertedWith("Not enough token balance to cover the collateral");
        });

        it("Should revert if proposal on non existant listing", async function () {
            const { users, lessee, proposal, listingId } = await setup(Stage.Proposing);

            // Create proposal on non existant listing
            await expect(users[lessee].ProposalManager.createProposal(listingId + 1, proposal)).to.be.revertedWith("Listing invalid");
        });

        it("Should revert if proposal on a cancelled listing", async function () {
            const { users, lessor, lessee, proposal, listingId } = await setup(Stage.Proposing);

            if (listingId === undefined) {
                console.log("/!\\ Error: listingId is undefined");
                return;
            }
            // Cancel listing
            await users[lessor].ListingManager.cancelListing(listingId);
            await expect(users[lessee].ProposalManager.createProposal(listingId + 1, proposal)).to.be.revertedWith("Listing invalid");
        });

        it("Should revert if proposal timestamp are incorrect", async function () {
            const { users, lessee, listing, proposal, listingId } = await setup(Stage.Proposing);

            // startTimestampProposal before the listing Date
            let faillingProposal: ProposalManager.ProposalParametersStruct = {...proposal, startTimestampProposal: Number(listing.startTimestamp) - 100};
            await expect(users[lessee].ProposalManager.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

            // endTimestampProposal before startTimestampProposal
            faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
            await expect(users[lessee].ProposalManager.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

            // endTimestampProposal before startTimestampProposal
            faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
            await expect(users[lessee].ProposalManager.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

            // startTimestampProposal after listing endTimestamp
            faillingProposal = {...proposal, startTimestampProposal: Number(listing.endTimestamp) + 100};
            await expect(users[lessee].ProposalManager.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");
        });

        it("Should update a proposal and emit update event", async function () {
            const { users, lessee, proposal, proposalUpdating, listingId } = await setup(Stage.Proposing);

            // create new proposal
            const txProp = await users[lessee].ProposalManager.createProposal(listingId, proposal);
            const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
            const propId = Number(eventLogProp.args[1]);

            await expect(users[lessee].ProposalManager.updateProposal(propId, proposalUpdating)).to.emit(users[lessee].ProposalManager, "ProposalUpdated");
            const updatedProposal = await users[lessee].ProposalManager.proposalIdToProposal(propId);
            expect(updatedProposal.listingId).to.equal(propId);
            expect(updatedProposal.proposalCreator).to.equal(lessee);
            expect(Number(updatedProposal.startTimestampProposal)).to.equal(Number(proposalUpdating.startTimestampProposal));
            expect(Number(updatedProposal.endTimestampProposal)).to.equal(Number(proposalUpdating.endTimestampProposal));
            expect(Number(updatedProposal.endTimestampRental)).to.equal(Number(proposalUpdating.endTimestampRental));
            expect(updatedProposal.isProRated).to.equal(proposalUpdating.isProRated);
            expect(updatedProposal.status).to.equal(ProposalStatus.PENDING);
        });

        it("Should revert if updating a non existant proposal", async function () {
            const { users, lessee, proposal, proposalUpdating, listingId } = await setup(Stage.Proposing);

            // create new proposal
            const txProp = await users[lessee].ProposalManager.createProposal(listingId, proposal);
            const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
            const propId = Number(eventLogProp.args[1]);

            await expect(users[lessee].ProposalManager.updateProposal(propId + 1, proposalUpdating)).to.be.reverted;
        });

        it("Should revert if updating a proposal with bad timestamp", async function () {
            const { users, lessee, listing, proposal, listingId } = await setup(Stage.Proposing);

            // create new proposal
            const txProp = await users[lessee].ProposalManager.createProposal(listingId, proposal);
            const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
            const propId = Number(eventLogProp.args[1]);

            // Testing bad timestamps for update
            // startTimestampProposal before the listing Date
            let faillingProposal: ProposalManager.ProposalParametersStruct = {...proposal, startTimestampProposal: Number(listing.startTimestamp) - 100};
            await expect(users[lessee].ProposalManager.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

            // endTimestampProposal before startTimestampProposal
            faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
            await expect(users[lessee].ProposalManager.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

            // endTimestampProposal before startTimestampProposal
            faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
            await expect(users[lessee].ProposalManager.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");

            // startTimestampProposal after listing endTimestamp
            faillingProposal = {...proposal, startTimestampProposal: Number(listing.endTimestamp) + 100};
            await expect(users[lessee].ProposalManager.updateProposal(propId, faillingProposal)).to.be.revertedWith("Timestamp error");
        });

        it("Should revert if updating a non ownerd proposal", async function () {
            const { users, lessor, lessee, proposal, proposalUpdating, listingId } = await setup(Stage.Proposing);

            // create new proposal
            const txProp = await users[lessee].ProposalManager.createProposal(listingId, proposal);
            const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
            const propId = Number(eventLogProp.args[1]);

            // test updating with lessor
            await expect(users[lessor].ProposalManager.updateProposal(propId, proposalUpdating)).to.be.revertedWith("Error: you are not the owner of the proposal");
        });

        it("Should be able to cancel a proposal and emit cancel event", async function () {
            const { users, lessee, proposal, listingId } = await setup(Stage.Proposing);

            // create new proposal
            const txProp = await users[lessee].ProposalManager.createProposal(listingId, proposal);
            const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
            const propId = Number(eventLogProp.args[1]);

            // cancel proposal
            await expect(users[lessee].ProposalManager.cancelProposal(propId)).to.emit(users[lessee].ProposalManager, "ProposalCancelled");
            const canceledProposal = await users[lessee].ProposalManager.proposalIdToProposal(propId);
            expect(canceledProposal.status).to.equal(ProposalStatus.CANCELLED);
        });

        it("Should revert if trying to cancel a cancelled  proposal", async function () {
            const { users, lessee, proposal, listingId } = await setup(Stage.Proposing);

            // create new proposal
            const txProp = await users[lessee].ProposalManager.createProposal(listingId, proposal);
            const eventLogProp = (await txProp.wait())?.logs[0] as EventLog;
            const propId = Number(eventLogProp.args[1]);

            // cancel proposal
            await users[lessee].ProposalManager.cancelProposal(propId);
            // cancel same proposal
            await expect(users[lessee].ProposalManager.cancelProposal(propId)).to.be.revertedWith("Proposal invalid");
        });
    });
});