import { expect } from "chai";
import { ethers } from "hardhat";
import { Lender, Lender__factory, MyToken, MyToken__factory } from "../typechain-types";
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
    REFUSED
}

describe('Lender', function () {
    async function deployFixture() {
        const [ owner, address2 ] = await ethers.getSigners();
        // Classic ERC721 contract
        const MyToken = await ethers.getContractFactory("MyToken");
        const myToken = await MyToken.deploy();
        await myToken.safeMint(owner.address, 0);
        // Lender contract
        const Lender = await ethers.getContractFactory("Lender");
        const lender = await Lender.deploy();
        // first approve the contract
        await myToken.setApprovalForAll(lender.getAddress(), true);
        // Usefull data
        let date = new Date();
        date.setDate(date.getDate() + 7);
        const listing: Lender.ListingParametersStruct = {
            assetContract: await myToken.getAddress(),
            tokenId: 0,
            collateralAmount: 1000000000,
            erc20DenominationUsed: "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E",
            startTimestamp: Date.now(),
            endTimestamp: new Date().setDate(new Date().getDate() + 7),
            pricePerDay: 300,
            comment: "No comment"
        };
        const listingUpdating: Lender.ListingParametersStruct = {
            assetContract: await myToken.getAddress(),
            tokenId: 0,
            collateralAmount: 100000,
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
        return { lender, listing, owner, address2, myToken, listingUpdating, proposal };
    }

    it("Should create a new listing and emit the creation event", async function () {
        const { lender, listing, owner, myToken } = await loadFixture(deployFixture);

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
        const { lender, listing, myToken } = await loadFixture(deployFixture);

        // unapprove the contract
        await myToken.setApprovalForAll(lender.getAddress(), false);

        await expect(lender.createListing(listing)).to.be.revertedWith("Escrow contract is not approved to transfer this nft");
    });

    it("Should revert if assetContract is invalid", async function () {
        const { lender, listing, myToken } = await loadFixture(deployFixture);

        const listingCopie = {...listing, assetContract: "0x0000000000000000000000000000000000000000"};
        await expect(lender.createListing(listingCopie)).to.be.revertedWith("Invalid nft contract address");
    });

    it("Should revert if timestamps is incorrect", async function () {
        const { lender, listing, myToken } = await loadFixture(deployFixture);

        let listingCopie = {...listing, endTimestamp: new Date().setDate(new Date().getDate() - 1)};
        await expect(lender.createListing(listingCopie)).to.be.revertedWith("Invalid end timestamp");
        listingCopie.startTimestamp = new Date().setDate(new Date().getDate() + 6);
        listingCopie.endTimestamp = new Date().setDate(new Date().getDate() + 4);
        await expect(lender.createListing(listingCopie)).to.be.revertedWith("Invalid end timestamp");
    });

    it("Should revert if collateral is set to 0", async function () {
        const { lender, listing, myToken } = await loadFixture(deployFixture);

        const listingCopie = {...listing, collateralAmount: 0};
        await expect(lender.createListing(listingCopie)).to.be.reverted;
    });

    it("Should revert if trying to create 2 listing of the same token", async function () {
        const { lender, listing, myToken } = await loadFixture(deployFixture);

        await lender.createListing(listing);
        await expect(lender.createListing(listing)).to.be.revertedWith("Can not create 2 listing of same NFT");
    });

    it("Should update a listing and emit event", async function () {
        const { lender, listing, listingUpdating, owner, myToken } = await loadFixture(deployFixture);

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
        const { lender, listing, myToken } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await lender.cancelListing(listingId);
        expect((await lender.listingIdToListing(listingId)).status).to.equal(ListingStatus.CANCELLED);
    });

    it("Should be able to recreate another listing after cancel the previous", async function () {
        const { lender, listing, myToken } = await loadFixture(deployFixture);

        let tx = await lender.createListing(listing);
        let eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        const tx2 = await lender.cancelListing(listingId);
        tx = await lender.createListing(listing);
        eventLog = (await tx.wait())?.logs[0] as EventLog;
        const secondListingId = Number(eventLog.args[2]);

        expect(listingId).not.to.be.equal(secondListingId);
    });

    it("Should revert if trying to update a cancelled listing", async function () {
        const { lender, listing, listingUpdating, myToken } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await lender.cancelListing(listingId);
        await expect(lender.updateListing(listingId, listingUpdating)).to.be.revertedWith("Listing is invalid");
    });

    it("Should revert if trying to update or cancel a listing doesn't owned", async function () {
        const { lender, listing, listingUpdating, myToken, address2 } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        const newLender = lender.connect(address2);
        await expect(newLender.updateListing(listingId, listingUpdating)).to.be.revertedWith("Error: you are not the owner of the listing");
        await expect(newLender.cancelListing(listingId)).to.be.revertedWith("Error: you are not the owner of the listing");
    });

    it("Should revert if trying to update or cancel a listing non existant", async function () {
        const { lender, listing, listingUpdating, myToken, address2 } = await loadFixture(deployFixture);

        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await expect(lender.updateListing(listingId + 1, listingUpdating)).to.be.reverted;
        await expect(lender.cancelListing(listingId + 1)).to.be.reverted;
    });

    // ---------------------------------------------------------------------------------------------------------------------------------------------

    it("Should create a proposal and emit event creation", async function () {
        const { lender, listing, proposal, owner } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal
        await expect(lender.createProposal(listingId, proposal)).to.emit(lender, "ProposalCreated");
        const proposalCreated = await lender.proposalIdToProposal(0); // hard coded
        expect(proposalCreated.listingId).to.equal(listingId);
        expect(proposalCreated.proposalCreator).to.equal(owner.address);
        expect(Number(proposalCreated.startTimestampProposal)).to.equal(Number(proposal.startTimestampProposal));
        expect(Number(proposalCreated.endTimestampProposal)).to.equal(Number(proposal.endTimestampProposal));
        expect(Number(proposalCreated.startTimestampRental)).to.equal(Number(proposal.startTimestampRental));
        expect(Number(proposalCreated.endTimestampRental)).to.equal(Number(proposal.endTimestampRental));
        expect(proposalCreated.isProRated).to.equal(proposal.isProRated);
        expect(proposalCreated.status).to.equal(ProposalStatus.PENDING);
    });

    it("Should revert if proposal on non existant listing", async function () {
        const { lender, listing, proposal, owner } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Create proposal on non existant listing
        await expect(lender.createProposal(listingId + 1, proposal)).to.be.revertedWith("Listing doesn't exist");
    });    

    it("Should revert if proposal timestamp are incorrect", async function () {
        const { lender, listing, proposal, owner } = await loadFixture(deployFixture);

        // Create listing
        const tx = await lender.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // startTimestampProposal before the listing Date
        let faillingProposal: Lender.ProposalParametersStruct = {...proposal, startTimestampProposal: Number(listing.startTimestamp) - 100};
        await expect(lender.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(lender.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampRental before the listing Date
        faillingProposal = {...proposal, startTimestampRental: Number(listing.startTimestamp) - 100};
        await expect(lender.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampRental before startTimestampRental
        faillingProposal = {...proposal, startTimestampRental: proposal.startTimestampRental, endTimestampRental: Number(proposal.startTimestampRental) - 100};
        await expect(lender.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // endTimestampProposal before startTimestampProposal
        faillingProposal = {...proposal, startTimestampProposal: proposal.startTimestampProposal, endTimestampProposal: Number(proposal.startTimestampProposal) - 100};
        await expect(lender.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");

        // startTimestampProposal after listing endTimestamp
        faillingProposal = {...proposal, startTimestampProposal: Number(listing.endTimestamp) + 100};
        await expect(lender.createProposal(listingId, faillingProposal)).to.be.revertedWith("Timestamp error");
    });
});