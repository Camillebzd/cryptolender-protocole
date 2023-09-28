import { expect } from "chai";
import { ethers } from "hardhat";
import { Lender, ListingManager } from "../typechain-types";
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

describe('ListingManager', function () {
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
        // ProposalManager contract
        const ProposalManager = await ethers.getContractFactory("ProposalManager");
        const proposalManager = await ProposalManager.deploy();
        // ListingManager contract
        const ListingManager = await ethers.getContractFactory("ListingManager");
        const listingManager = await ListingManager.deploy();
        await listingManager.setProposalManagerContract(await proposalManager.getAddress());
        const listingManagerFirstUser = listingManager.connect(firstUser);
        // first approve the proposalManager on nft contract
        const myToken721FirstUser = myToken721.connect(firstUser);
        await myToken721FirstUser.setApprovalForAll(proposalManager.getAddress(), true);
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
        return { firstUser, secondUser, listingManagerFirstUser, proposalManager, myToken721FirstUser, listing, listingUpdating };
    }

    it("Should create a new listing and emit the creation event", async function () {
        const { firstUser, listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        // create new listing and retreive event
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // Check event data
        expect(eventLog.fragment.name).to.equal("ListingCreated");
        expect(eventLog.args[0]).to.equal(firstUser.address); // listingCreator
        expect(eventLog.args[1]).to.equal(listing.assetContract); // assetContract
        const listingValues = eventLog.args[3]; // listing value in an array ordered
        expect(Number(listingValues[0])).to.equal(listingId);
        expect(listingValues[1]).to.equal(firstUser.address);
        expect(listingValues[2]).to.equal(listing.assetContract);
        expect(Number(listingValues[3])).to.equal(listing.tokenId);
        expect(Number(listingValues[4])).to.equal(listing.collateralAmount);
        expect(Number(listingValues[5])).to.equal(listing.startTimestamp);
        expect(Number(listingValues[6])).to.equal(listing.endTimestamp);
        expect(Number(listingValues[7])).to.equal(listing.pricePerDay);
        expect(listingValues[8]).to.equal(listing.comment);
        expect(Number(listingValues[9])).to.equal(ListingStatus.PENDING);

        // Check data in storage
        const newListing = await listingManagerFirstUser.listingIdToListing(listingId);
        expect(Number(newListing.listingId)).to.equal(listingId);
        expect(newListing.listingCreator).to.equal(firstUser.address);
        expect(newListing.assetContract).to.equal(listing.assetContract);
        expect(Number(newListing.tokenId)).to.equal(Number(listing.tokenId));
        expect(Number(newListing.collateralAmount)).to.equal(listing.collateralAmount);
        // expect(newListing.erc20DenominationUsed).to.equal(listing.erc20DenominationUsed);
        expect(Number(newListing.startTimestamp)).to.equal(listing.startTimestamp);
        expect(Number(newListing.endTimestamp)).to.equal(listing.endTimestamp);
        expect(Number(newListing.pricePerDay)).to.equal(listing.pricePerDay);
        expect(newListing.comment).to.equal(listing.comment);
        expect(newListing.status).to.equal(ListingStatus.PENDING);
    });

    it("Should revert if owner doesn't setApprovalForAll", async function () {
        const { listingManagerFirstUser, proposalManager, myToken721FirstUser, listing } = await loadFixture(deployFixture);

        // unapprove the proposal contract
        await myToken721FirstUser.setApprovalForAll(proposalManager.getAddress(), false);

        await expect(listingManagerFirstUser.createListing(listing)).to.be.revertedWith("Escrow contract is not approved to transfer this nft");
    });

    it("Should revert if owner doesn't own the nft", async function () {
        const { listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        // use in listing the token 1 which is the token to secondUser
        await expect(listingManagerFirstUser.createListing({...listing, tokenId: 1})).to.be.revertedWith("You are not the owner of the nft");
    });

    it("Should revert if assetContract is invalid", async function () {
        const { listingManagerFirstUser, proposalManager, listing } = await loadFixture(deployFixture);

        // use a null contract
        await expect(listingManagerFirstUser.createListing({...listing, assetContract: "0x0000000000000000000000000000000000000000"})).to.be.revertedWith("Invalid nft contract address");
        // use a no ERC721 contract but can not catch the revert for the moment
        await expect(listingManagerFirstUser.createListing({...listing, assetContract: proposalManager.getAddress()})).to.be.reverted;

    });

    it("Should revert if timestamps is incorrect", async function () {
        const { listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        // endTimestamp before current time
        await expect(listingManagerFirstUser.createListing({...listing, endTimestamp: new Date().setDate(new Date().getDate() - 10)})).to.be.revertedWith("Invalid end timestamp");
        // endTimestamp before startTimestamp
        await expect(listingManagerFirstUser.createListing({...listing, endTimestamp: new Date().setDate(new Date().getDate() + 4), startTimestamp: new Date().setDate(new Date().getDate() + 6)})).to.be.revertedWith("Invalid end timestamp");
    });

    it("Should revert if collateral is set to 0", async function () {
        const { listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        // collateral set to 0
        await expect(listingManagerFirstUser.createListing({...listing, collateralAmount: 0})).to.be.revertedWith("Can't accept 0 collateral");
    });

    it("Should revert if trying to create 2 listing of the same token", async function () {
        const { listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        // create first listing
        await listingManagerFirstUser.createListing(listing);
        // create second listing with same token
        await expect(listingManagerFirstUser.createListing(listing)).to.be.revertedWith("Can not create 2 listing of same NFT");
    });

    it("Should update a listing and emit event", async function () {
        const { firstUser, listingManagerFirstUser, listing, listingUpdating } = await loadFixture(deployFixture);

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // update listing 
        // TODO check data in the event
        await expect(listingManagerFirstUser.updateListing(listingId, listingUpdating)).to.emit(listingManagerFirstUser, "ListingUpdated");
        // Check data storage
        const updatedListing = await listingManagerFirstUser.listingIdToListing(listingId);
        expect(updatedListing.listingCreator).to.equal(firstUser.address);
        expect(updatedListing.assetContract).to.equal(listing.assetContract); // should stay the same
        expect(Number(updatedListing.tokenId)).to.equal(Number(listing.tokenId)); // should stay the same
        expect(Number(updatedListing.collateralAmount)).to.equal(listingUpdating.collateralAmount);
        // expect(newListing.erc20DenominationUsed).to.equal(listing.erc20DenominationUsed);
        expect(updatedListing.startTimestamp).to.equal(listingUpdating.startTimestamp);
        expect(Number(updatedListing.endTimestamp)).to.equal(listingUpdating.endTimestamp);
        expect(Number(updatedListing.pricePerDay)).to.equal(listingUpdating.pricePerDay);
        expect(updatedListing.comment).to.equal(listingUpdating.comment);
        expect(updatedListing.status).to.equal(ListingStatus.PENDING);
    });

    it("Should revert if update a listing with bad timestamp", async function () {
        const { listingManagerFirstUser, listing, listingUpdating } = await loadFixture(deployFixture);

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // endTimestamp before current time
        await expect(listingManagerFirstUser.updateListing(listingId, {...listingUpdating, endTimestamp: new Date().setDate(new Date().getDate() - 10)})).to.be.revertedWith("Invalid end timestamp");
        // endTimestamp before startTimestamp
        await expect(listingManagerFirstUser.updateListing(listingId, {...listingUpdating, endTimestamp: new Date().setDate(new Date().getDate() + 4), startTimestamp: new Date().setDate(new Date().getDate() + 6)})).to.be.revertedWith("Invalid end timestamp");
    });

    it("Should be able to cancel a listing", async function () {
        const { listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        await expect(listingManagerFirstUser.cancelListing(listingId)).to.emit(listingManagerFirstUser, "ListingCancelled");
        expect((await listingManagerFirstUser.listingIdToListing(listingId)).status).to.equal(ListingStatus.CANCELLED);
    });

    it("Should be able to recreate another listing with same token after cancelling the previous one", async function () {
        const { listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // cancel listing
        await listingManagerFirstUser.cancelListing(listingId);

        // create a new listing with same token
        const tx2 = await listingManagerFirstUser.createListing(listing);
        const eventLog2 = (await tx2.wait())?.logs[0] as EventLog;
        const secondListingId = Number(eventLog2.args[2]);

        expect(listingId).not.to.be.equal(secondListingId);
    });

    it("Should revert if trying to cancel a cancelled listing", async function () {
        const { listingManagerFirstUser, listing } = await loadFixture(deployFixture);

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // cancel listing first time
        await listingManagerFirstUser.cancelListing(listingId);
        // cancel listing second time
        await expect(listingManagerFirstUser.cancelListing(listingId)).to.be.revertedWith("Listing is invalid");
    });

    it("Should revert if trying to update a cancelled listing", async function () {
        const { listingManagerFirstUser, listing, listingUpdating } = await loadFixture(deployFixture);

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // cancel listing
        await listingManagerFirstUser.cancelListing(listingId);
        // update cancelled listing
        await expect(listingManagerFirstUser.updateListing(listingId, listingUpdating)).to.be.revertedWith("Listing is invalid");
    });

    it("Should revert if trying to update or cancel a listing doesn't owned", async function () {
        const { secondUser, listingManagerFirstUser, listing, listingUpdating } = await loadFixture(deployFixture);

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // setup second user on listingManager and try to update or cancel not owned listing
        const newListingManager = listingManagerFirstUser.connect(secondUser);
        await expect(newListingManager.updateListing(listingId, listingUpdating)).to.be.revertedWith("Error: you are not the owner of the listing");
        await expect(newListingManager.cancelListing(listingId)).to.be.revertedWith("Error: you are not the owner of the listing");
    });

    it("Should revert if trying to update or cancel a listing non existant", async function () {
        const { listingManagerFirstUser, listing, listingUpdating } = await loadFixture(deployFixture);

        // create new listing
        const tx = await listingManagerFirstUser.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        const listingId = Number(eventLog.args[2]);

        // update or cancel a non existant listing
        await expect(listingManagerFirstUser.updateListing(listingId + 1, listingUpdating)).to.be.reverted;
        await expect(listingManagerFirstUser.cancelListing(listingId + 1)).to.be.reverted;
    });
});