import { expect } from "chai";
import { network } from "hardhat";
import { EventLog } from "ethers"
import { setup } from "./utils/setup";
import { developmentChains } from "../helper-hardhat-config";

enum ListingStatus {
    UNSET,
    PENDING, 
    COMPLETED, 
    CANCELLED
};

describe('ListingManager', function () {
    beforeEach(async () => {
        if (!developmentChains.includes(network.name)) {
            throw "You need to be on a development chain to run tests"
        }
    });

    describe('Setup', function () {
        it("Should create all the links", async function () {
            const { ListingManager, ProposalManager, RentalManager, Escrow } = await setup();

            // check all the others contracts of the protocol are linked
            expect(await ListingManager.proposalManager()).to.equal(await ProposalManager.getAddress());
            expect(await ListingManager.rentalManager()).to.equal(await RentalManager.getAddress());
            expect(await ListingManager.escrow()).to.equal(await Escrow.getAddress());
        });

        it("Lessor approve the escrow to move his NFTs", async function () {
            const { MyToken721, lessor, Escrow } = await setup();

            // check the approvement of the lessor
            expect(await MyToken721.isApprovedForAll(lessor, await Escrow.getAddress())).to.equal(true);
        });
    });

    describe('Listing management', function () {
        it("Should create a new listing and emit the creation event", async function () {
            const { users, lessor, listing } = await setup();

            // create new listing and retreive event
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // Check event data
            expect(eventLog.fragment.name).to.equal("ListingCreated");
            expect(eventLog.args[0]).to.equal(lessor); // listingCreator
            expect(eventLog.args[1]).to.equal(listing.assetContract); // assetContract
            const listingValues = eventLog.args[3]; // listing value in an array ordered
            expect(Number(listingValues[0])).to.equal(listingId);
            expect(listingValues[1]).to.equal(lessor);
            expect(listingValues[2]).to.equal(listing.assetContract);
            expect(Number(listingValues[3])).to.equal(listing.tokenId);
            expect(Number(listingValues[4])).to.equal(listing.collateralAmount);
            expect(Number(listingValues[5])).to.equal(listing.startTimestamp);
            expect(Number(listingValues[6])).to.equal(listing.endTimestamp);
            expect(Number(listingValues[7])).to.equal(listing.pricePerDay);
            expect(listingValues[8]).to.equal(listing.comment);
            expect(Number(listingValues[9])).to.equal(ListingStatus.PENDING);

            // Check data in storage
            const newListing = await users[lessor].ListingManager.listingIdToListing(listingId);
            expect(Number(newListing.listingId)).to.equal(listingId);
            expect(newListing.listingCreator).to.equal(lessor);
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
            const { users, lessor, listing, Escrow } = await setup();

            // unapprove the escrow contract
            await users[lessor].MyToken721.setApprovalForAll(await Escrow.getAddress(), false);

            await expect(users[lessor].ListingManager.createListing(listing)).to.be.revertedWith("Escrow contract is not approved to transfer this nft");
        });

        it("Should revert if owner doesn't own the nft", async function () {
            const { users, lessor, listing } = await setup();

            // use in listing the token 1 which is the token to secondUser
            await expect(users[lessor].ListingManager.createListing({...listing, tokenId: 1})).to.be.revertedWith("You are not the owner of the nft");
        });

        it("Should revert if assetContract is invalid", async function () {
            const { users, lessor, listing, Escrow } = await setup();

            // use a null contract
            await expect(users[lessor].ListingManager.createListing({...listing, assetContract: "0x0000000000000000000000000000000000000000"})).to.be.revertedWith("Invalid nft contract address");
            // use a no ERC721 contract but can not catch the revert for the moment
            await expect(users[lessor].ListingManager.createListing({...listing, assetContract: await Escrow.getAddress()})).to.be.reverted;

        });

        it("Should revert if timestamps is incorrect", async function () {
            const { users, lessor, listing } = await setup();

            // endTimestamp before current time
            await expect(users[lessor].ListingManager.createListing({...listing, endTimestamp: new Date().setDate(new Date().getDate() - 10)})).to.be.revertedWith("Invalid end timestamp");
            // endTimestamp before startTimestamp
            await expect(users[lessor].ListingManager.createListing({...listing, endTimestamp: new Date().setDate(new Date().getDate() + 4), startTimestamp: new Date().setDate(new Date().getDate() + 6)})).to.be.revertedWith("Invalid end timestamp");
        });

        it("Should revert if collateral is set to 0", async function () {
            const { users, lessor, listing } = await setup();

            // collateral set to 0
            await expect(users[lessor].ListingManager.createListing({...listing, collateralAmount: 0})).to.be.revertedWith("Can't accept 0 collateral");
        });

        it("Should revert if trying to create 2 listing of the same token", async function () {
            const { users, lessor, listing } = await setup();

            // create first listing
            await users[lessor].ListingManager.createListing(listing);
            // create second listing with same token
            await expect(users[lessor].ListingManager.createListing(listing)).to.be.revertedWith("Can not create 2 listing of same NFT");
        });

        it("Should update a listing and emit event", async function () {
            const { users, lessor, listing, listingUpdating, ListingManager } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // update listing 
            // TODO check data in the event
            await expect(users[lessor].ListingManager.updateListing(listingId, listingUpdating)).to.emit(ListingManager, "ListingUpdated");
            // Check data storage
            const updatedListing = await ListingManager.listingIdToListing(listingId);
            expect(updatedListing.listingCreator).to.equal(lessor);
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
            const { users, lessor, listing, listingUpdating, ListingManager } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // endTimestamp before current time
            await expect(users[lessor].ListingManager.updateListing(listingId, {...listingUpdating, endTimestamp: new Date().setDate(new Date().getDate() - 10)})).to.be.revertedWith("Invalid end timestamp");
            // endTimestamp before startTimestamp
            await expect(users[lessor].ListingManager.updateListing(listingId, {...listingUpdating, endTimestamp: new Date().setDate(new Date().getDate() + 4), startTimestamp: new Date().setDate(new Date().getDate() + 6)})).to.be.revertedWith("Invalid end timestamp");
        });

        it("Should be able to cancel a listing", async function () {
            const { users, lessor, listing, ListingManager } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            await expect(users[lessor].ListingManager.cancelListing(listingId)).to.emit(ListingManager, "ListingCancelled");
            expect((await users[lessor].ListingManager.listingIdToListing(listingId)).status).to.equal(ListingStatus.CANCELLED);
        });

        it("Should be able to recreate another listing with same token after cancelling the previous one", async function () {
            const { users, lessor, listing } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // cancel listing
            await users[lessor].ListingManager.cancelListing(listingId);

            // create a new listing with same token
            const tx2 = await users[lessor].ListingManager.createListing(listing);
            const eventLog2 = (await tx2.wait())?.logs[0] as EventLog;
            const secondListingId = Number(eventLog2.args[2]);

            expect(listingId).not.to.be.equal(secondListingId);
        });

        it("Should revert if trying to cancel a cancelled listing", async function () {
            const { users, lessor, listing } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // cancel listing first time
            await users[lessor].ListingManager.cancelListing(listingId);
            // cancel listing second time
            await expect(users[lessor].ListingManager.cancelListing(listingId)).to.be.revertedWith("Listing is invalid");
        });

        it("Should revert if trying to update a cancelled listing", async function () {
            const { users, lessor, listing, listingUpdating } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // cancel listing
            await users[lessor].ListingManager.cancelListing(listingId);
            // update cancelled listing
            await expect(users[lessor].ListingManager.updateListing(listingId, listingUpdating)).to.be.revertedWith("Listing is invalid");
        });

        it("Should revert if trying to update or cancel a listing doesn't owned", async function () {
            const { users, lessor, lessee, listing, listingUpdating } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // setup second user on listingManager and try to update or cancel not owned listing
            await expect(users[lessee].ListingManager.updateListing(listingId, listingUpdating)).to.be.revertedWith("Error: you are not the owner of the listing");
            await expect(users[lessee].ListingManager.cancelListing(listingId)).to.be.revertedWith("Error: you are not the owner of the listing");
        });

        it("Should revert if trying to update or cancel a listing non existant", async function () {
            const { users, lessor, listing, listingUpdating } = await setup();

            // create new listing
            const tx = await users[lessor].ListingManager.createListing(listing);
            const eventLog = (await tx.wait())?.logs[0] as EventLog;
            const listingId = Number(eventLog.args[2]);

            // update or cancel a non existant listing
            await expect(users[lessor].ListingManager.updateListing(listingId + 1, listingUpdating)).to.be.reverted;
            await expect(users[lessor].ListingManager.cancelListing(listingId + 1)).to.be.reverted;
        });
    });
});