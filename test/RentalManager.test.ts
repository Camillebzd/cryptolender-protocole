import { expect } from "chai";
import { ethers } from "hardhat";
import { ListingManager, ProposalManager } from "../typechain-types";
import {
    loadFixture,
    time
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { EventLog } from "ethers"
import { Stage, setup } from "./utils/setup";

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
    describe('Setup', function () {
        it("Should create all the links", async function () {
            const { ListingManager, ProposalManager, RentalManager, Escrow } = await setup(Stage.Renting);

            // check all the others contracts of the protocol are linked
            expect(await RentalManager.listingManager()).to.equal(await ListingManager.getAddress());
            expect(await RentalManager.proposalManager()).to.equal(await ProposalManager.getAddress());
            expect(await RentalManager.escrow()).to.equal(await Escrow.getAddress());
        });

        it("Lessor approve the Escrow to move his NFTs", async function () {
            const { MyToken721, lessor, Escrow } = await setup(Stage.Renting);

            // check the approvement of the lessor
            expect(await MyToken721.isApprovedForAll(lessor, await Escrow.getAddress())).to.equal(true);
        });

        it("Lessee approve the Escrow to move his NFTs", async function () {
            const { MyToken20, lessee, Escrow, collateralAmount } = await setup(Stage.Proposing);

            // check the approvement of the lessor
            expect(await MyToken20.allowance(lessee, await Escrow.getAddress())).to.be.greaterThanOrEqual(collateralAmount);
        });
    });

    describe('Proposal management', function () {
        it("Should create a rental and emit creation rental event", async function () {
            const { users, lessor, lessee, listing, proposal, listingId, proposalId } = await setup(Stage.Renting);
    
            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);
    
            // Check event data
            expect(eventLogRent.fragment.name).to.equal("RentalCreated");
            expect(eventLogRent.args[0]).to.equal(lessor); // owner
            expect(eventLogRent.args[1]).to.equal(lessee); // renter
            const rentalValues = eventLogRent.args[3]; // rental value in an array ordered
            expect(Number(rentalValues[0])).to.equal(rentalId);
            expect(rentalValues[1][0]).to.equal(lessor);
            expect(rentalValues[1][1]).to.equal(lessee);
            expect(rentalValues[1][2]).to.equal(listing.assetContract);
            expect(Number(rentalValues[1][3])).to.equal(listing.tokenId);
            expect(Number(rentalValues[1][4])).to.equal(listing.collateralAmount);
            expect(Number(rentalValues[1][5])).to.equal(listing.pricePerDay);
            // how to determine that ? -> force time with hardhat
            // expect(Number(rentalValues[1][6])).to.equal((new Date()).getTime());
            expect(Number(rentalValues[1][7])).to.equal(proposal.endTimestampRental);
            expect(rentalValues[1][8]).to.equal(proposal.isProRated);
            expect(rentalValues[2][0]).to.equal(listingId);
            expect(rentalValues[2][1]).to.equal(proposalId);
    
            // Check data in storage
            const newRental = await users[lessor].RentalManager.rentalIdToRental(rentalId);
            expect(newRental.details.owner).to.equal(lessor);
            expect(newRental.details.renter).to.equal(lessee);
            expect(newRental.details.assetContract).to.equal(listing.assetContract);
            expect(newRental.details.tokenId).to.equal(listing.tokenId);
            expect(newRental.details.collateralAmount).to.equal(listing.collateralAmount);
            expect(newRental.details.pricePerDay).to.equal(listing.pricePerDay);
            // handle this
            // expect(newRental.details.startingDate).to.equal();
            expect(newRental.details.endingDate).to.equal(proposal.endTimestampRental);
            expect(newRental.details.isProRated).to.equal(proposal.isProRated);
            expect(newRental.info.listingId).to.equal(listingId);
            expect(newRental.info.proposalId).to.equal(proposalId);
    
            // check listing and proposal states
            expect((await users[lessor].ListingManager.listingIdToListing(listingId)).status).to.equal(ListingStatus.COMPLETED);
            expect((await users[lessor].ProposalManager.proposalIdToProposal(proposalId)).status).to.equal(ProposalStatus.ACCEPTED);
        });

        it("Should give the nft to renter and collateral to Escrow", async function () {
            const { users, lessor, lessee, listing, proposal, listingId, proposalId, Escrow, collateralAmount } = await setup(Stage.Renting);

            // check before rent
            const lesseeBalance = Number(await users[lessee].MyToken20.balanceOf(lessee));
            expect(await users[lessor].MyToken721.ownerOf(listing.tokenId)).to.equal(lessor);
            expect(await users[lessee].MyToken20.balanceOf(await Escrow.getAddress())).to.equal(0);
            expect(await users[lessee].MyToken20.balanceOf(lessee)).to.be.greaterThanOrEqual(collateralAmount);

            // accept proposal and create rental
            await users[lessor].ProposalManager.acceptProposal(proposalId);

            // check after rental creation
            expect(await users[lessor].MyToken721.ownerOf(listing.tokenId)).to.equal(lessee);
            expect(await users[lessee].MyToken20.balanceOf(Escrow.getAddress())).to.equal(collateralAmount);
            expect(await users[lessee].MyToken20.balanceOf(lessee)).to.equal(lesseeBalance - collateralAmount);
        });

        it("Should revert if trying to accept a cancelled listing", async function () {
            const { users, lessor, listingId, proposalId } = await setup(Stage.Renting);

            // cancel listing before accept
            await users[lessor].ListingManager.cancelListing(listingId);
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.revertedWith("Listing invalid");
        });

        it("Should revert if trying to accept a cancelled proposal", async function () {
            const { users, lessor, lessee, proposalId } = await setup(Stage.Renting);

            // cancel proposal before accept
            await users[lessee].ProposalManager.cancelProposal(proposalId);
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.revertedWith("Proposal invalid");
        });
    
        it("Should revert if trying to accept a proposal without owning the listing", async function () {
            const { users, lessee, proposalId } = await setup(Stage.Renting);

            // secondUser accept his own proposal
            await expect(users[lessee].ProposalManager.acceptProposal(proposalId)).to.revertedWith("Not allowed to accept this proposal");
        });
    
        it("Should revert if trying to accept 2 times the same proposal or accept 2 proposals on the same listing", async function () {
            const { users, lessor, lessee, proposal, listingId, proposalId } = await setup(Stage.Renting);

            // create second proposal
            const txProp2 = await users[lessee].ProposalManager.createProposal(listingId, proposal);
            const eventLogProp2 = (await txProp2.wait())?.logs[0] as EventLog;
            const proposalId2 = Number(eventLogProp2.args[1]);


            await users[lessor].ProposalManager.acceptProposal(proposalId);
            // try to accept 2 times the same proposal
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.be.revertedWith("Proposal invalid");
            // try to accept a second proposal of the same listing
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId2)).to.be.revertedWith("Listing invalid");
        });
    
        it("Should revert if trying to accept proposal and approves on nft or collateral are removed", async function () {
            const { users, lessor, lessee, proposalId, Escrow } = await setup(Stage.Renting);

            // remove nft approve
            await users[lessor].MyToken721.setApprovalForAll(await Escrow.getAddress(), false);
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.be.revertedWith("Escrow contract is not approved to transfer this nft");
            await users[lessor].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);

            // remove collateral amount
            await users[lessee].MyToken20.approve(await Escrow.getAddress(), 0);
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.be.revertedWith("Escrow contract is not approved to transfer collateral");
        });

        it("Should revert if trying to accept proposal and timestamps are bad", async function () {
            const { users, lessor, lessee, listing, proposal, listingId, proposalId } = await setup(Stage.Renting);

            // Listing expired
            await time.setNextBlockTimestamp(Number(listing.endTimestamp) + 1); // increase time
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.be.revertedWith("Listing expired");

            // Proposal expired
            await users[lessor].ListingManager.updateListing(listingId, {...listing, endTimestamp: Number(proposal.endTimestampRental) + 10});
            await time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1); // increase time
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.be.revertedWith("Proposal expired");
            // Proposal expired 
            await users[lessee].ProposalManager.updateProposal(proposalId, {...proposal, endTimestampProposal: Number(proposal.endTimestampProposal) + 10});
            await time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 3); // increase time
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.be.revertedWith("Proposal expired");
        });

        it("Should revert if trying to accept proposal and you don't own the nft anymore", async function () {
            const { users, lessor, lessee, proposalId } = await setup(Stage.Renting);

            // transfer the nft so you don't own it anymore
            await users[lessor].MyToken721.transferFrom(lessor, lessee, 0);
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.revertedWith("You are not the owner of the nft");
        });

        it("Should revert if trying to accept proposal and renter doesn't have enough founds", async function () {
            const { users, lessor, lessee, proposalId, collateralAmount } = await setup(Stage.Renting);

            // transfer some founds so secondUser doesn't have enough for collateral
            await users[lessee].MyToken20.transfer(lessor, Number(await users[lessee].MyToken20.balanceOf(lessee)) - collateralAmount + 1);
            await expect(users[lessor].ProposalManager.acceptProposal(proposalId)).to.revertedWith("Not enough token balance to cover the collateral");
        });

        it("Should refund the NFT, retreive collateral, owner balance increase and Escrow own the nft (no pro-rated)", async function () {
            const { users, lessor, lessee, listing, proposal, proposalId, commissionRate, Escrow } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);
            const balanceAfterProposalAccepted = Number(await users[lessee].MyToken20.balanceOf(lessee));

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
            users[lessee].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);

            // return the nft and retreive collateral
            await expect(users[lessee].RentalManager.refundRental(rentalId)).to.emit(users[lessee].RentalManager, "RentalRefunded");

            // user retreive collateral minus paied commission and rental
            expect(await users[lessee].MyToken20.balanceOf(lessee)).to.equal(balanceAfterProposalAccepted + Number(listing.collateralAmount) - pricePaied - commission);
            // Escrow own the nft and owner balance increased
            expect(await users[lessor].MyToken721.ownerOf(listing.tokenId)).to.equal(await Escrow.getAddress());
            expect(await Escrow.ownerBalance(lessor, await users[lessee].MyToken20.getAddress())).to.equal(pricePaied);
            // check rental state
            expect((await users[lessor].RentalManager.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
        });

        it("Should refund the NFT, retreive collateral, owner balance increase and Escrow own the nft (pro-rated)", async function () {
            const { users, lessor, lessee, commissionRate, listing, proposal, proposalId, Escrow } = await setup(Stage.Renting);

            // update proposal to pro rated
            await users[lessee].ProposalManager.updateProposal(proposalId, {...proposal, isProRated: true});

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);
            const balanceAfterProposalAccepted = Number(await users[lessee].MyToken20.balanceOf(lessee));

            // change time and calcul price
            const lastBlockTimestampStartRental = (await ethers.provider.getBlock("latest"))?.date as Date;
            // simulate time change in blockchain
            const days = 4;
            let timeAddedTimestamp = new Date(lastBlockTimestampStartRental);
            timeAddedTimestamp.setDate(timeAddedTimestamp.getDate() + days);
            time.setNextBlockTimestamp(timeAddedTimestamp);

            // approve the contract
            users[lessee].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);

            // return the nft and retreive collateral
            await expect(users[lessee].RentalManager.refundRental(rentalId)).to.emit(users[lessee].RentalManager, "RentalRefunded");

            // calculate the rest after refundRental to be sure about execution time
            const lastBlockTimestampRefundRental = (await ethers.provider.getBlock("latest"))?.date as Date;
            const totalDays = Math.ceil(Number(lastBlockTimestampRefundRental.getTime() - lastBlockTimestampStartRental.getTime()) / (1000 * 3600 * 24));
            const pricePaied = totalDays * Number(listing.pricePerDay);
            const commission = commissionRate * pricePaied / 100;

            // user retreive collateral minus paied commission and rental
            expect(await users[lessee].MyToken20.balanceOf(lessee)).to.equal(balanceAfterProposalAccepted + Number(listing.collateralAmount) - pricePaied - commission);
            // Escrow own the nft and owner balance increased
            expect(await users[lessor].MyToken721.ownerOf(listing.tokenId)).to.equal(await Escrow.getAddress());
            expect(await Escrow.ownerBalance(lessor, await users[lessee].MyToken20.getAddress())).to.equal(pricePaied);
            // check rental state
            expect((await users[lessor].RentalManager.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
        });

        it("Should refund the NFT, retreive collateral, owner balance increase and Escrow own the nft (no pro-rated, 30mins after)", async function () {
            const { users, lessor, lessee, commissionRate, listing, proposal, proposalId, Escrow } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);
            const balanceAfterProposalAccepted = Number(await users[lessee].MyToken20.balanceOf(lessee));

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
            users[lessee].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);

            // return the nft and retreive collateral
            await expect(users[lessee].RentalManager.refundRental(rentalId)).to.emit(users[lessee].RentalManager, "RentalRefunded");

            // user retreive collateral minus paied commission and rental
            expect(await users[lessee].MyToken20.balanceOf(lessee)).to.equal(balanceAfterProposalAccepted + Number(listing.collateralAmount) - pricePaied - commission);
            // Escrow own the nft and owner balance increased
            expect(await users[lessor].MyToken721.ownerOf(listing.tokenId)).to.equal(await Escrow.getAddress());
            expect(await Escrow.ownerBalance(lessor, await users[lessee].MyToken20.getAddress())).to.equal(pricePaied);
            // check rental state
            expect((await users[lessor].RentalManager.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
        });

        it("Should refund the NFT, retreive collateral, owner balance increase and Escrow own the nft (pro-rated 30, min after)", async function () {
            const { users, lessor, lessee, commissionRate, listing, proposal, proposalId, Escrow } = await setup(Stage.Renting);

            // update proposal to pro rated
            await users[lessee].ProposalManager.updateProposal(proposalId, {...proposal, isProRated: true});

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);
            const balanceAfterProposalAccepted = Number(await users[lessee].MyToken20.balanceOf(lessee));

            // change time and calcul price
            const lastBlockTimestampStartRental = (await ethers.provider.getBlock("latest"))?.date as Date;
            // simulate time change in blockchain
            const minutes = 30;
            let timeAddedTimestamp = new Date(lastBlockTimestampStartRental);
            timeAddedTimestamp.setMinutes(timeAddedTimestamp.getMinutes() + minutes);
            time.setNextBlockTimestamp(timeAddedTimestamp);

            // approve the contract
            users[lessee].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);

            // return the nft and retreive collateral
            await expect(users[lessee].RentalManager.refundRental(rentalId)).to.emit(users[lessee].RentalManager, "RentalRefunded");

            // calculate the rest after refundRental to be sure about execution time
            const lastBlockTimestampRefundRental = (await ethers.provider.getBlock("latest"))?.date as Date;
            const totalDays = Math.ceil(Number(lastBlockTimestampRefundRental.getTime() - lastBlockTimestampStartRental.getTime()) / (1000 * 3600 * 24));
            expect(totalDays).to.equal(1); // because even if you keep it 30mins you pay at least a complet day
            const pricePaied = totalDays * Number(listing.pricePerDay);
            const commission = commissionRate * pricePaied / 100;

            // user retreive collateral minus paied commission and rental
            expect(await users[lessee].MyToken20.balanceOf(lessee)).to.equal(balanceAfterProposalAccepted + Number(listing.collateralAmount) - pricePaied - commission);
            // Escrow own the nft and owner balance increased
            expect(await users[lessor].MyToken721.ownerOf(listing.tokenId)).to.equal(await Escrow.getAddress());
            expect(await Escrow.ownerBalance(lessor, await users[lessee].MyToken20.getAddress())).to.equal(pricePaied);
            // check rental state
            expect((await users[lessor].RentalManager.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.REFUND);
        });

        // is it a good behavior ? Do we want this ?
        it("Should revert if refund while not be renter even if owning the nft", async function () {
            const { users, lessor, lessee, listing, proposalId, Escrow } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);

            // renter send the nft to other user
            users[lessee].MyToken721.transferFrom(lessee, lessor, listing.tokenId);
            
            // the other user try to refund the rental
            await users[lessor].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);
            await expect(users[lessor].RentalManager.refundRental(rentalId)).to.revertedWith("Not allowed to renfund");
        });

        it("Should revert if refund and no approve set from renter to Escrow", async function () {
            const { users, lessor, lessee, proposalId } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);

            // refund without setApproval to Escrow
            await expect(users[lessee].RentalManager.refundRental(rentalId)).to.revertedWith("Escrow contract is not approved to transfer this nft");
        });

        it("Should revert if refund without owning the nft anymore", async function () {
            const { users, lessor, lessee, listing, proposalId, Escrow } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);

            // renter send the nft to somebody else
            await users[lessee].MyToken721.transferFrom(lessee, lessor, listing.tokenId);
            await users[lessee].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);
            await expect(users[lessee].RentalManager.refundRental(rentalId)).to.revertedWith("You are not the owner of the nft");
        });

        it("Should revert if refund an invalid rental", async function () {
            const { users, lessor, lessee, proposalId, Escrow } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);
            
            // approve the contract
            users[lessee].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);

            await expect(users[lessee].RentalManager.refundRental(rentalId + 1)).to.reverted;
        });

        it("Should be able to liquidate a non refunded rental and expired", async function () {
            const { users, lessor, lessee, listing, proposal, proposalId } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);

            // advance time after the end of rental
            time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1);

            await expect(users[lessor].RentalManager.liquidateRental(rentalId)).to.emit(users[lessor].RentalManager, "RentalLiquidated");
            // check rental state
            expect((await users[lessor].RentalManager.rentalIdToRental(rentalId)).status).to.equal(RentalStatus.LIQUIDATED);
            // check liquidation amount
            expect(await users[lessee].MyToken20.balanceOf(lessor)).to.equal(listing.collateralAmount);
        });

        it("Should revert if trying to liquidate a refunded rental", async function () {
            const { users, lessor, lessee, proposal, proposalId, Escrow } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);

            // approve the contract
            users[lessee].MyToken721.setApprovalForAll(await Escrow.getAddress(), true);

            // return the nft and retreive collateral
            await expect(users[lessee].RentalManager.refundRental(rentalId)).to.emit(users[lessee].RentalManager, "RentalRefunded");
            
            // advance time after the end of rental
            time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1);
            await expect(users[lessor].RentalManager.liquidateRental(rentalId)).to.revertedWith("Rental invalid");
        });

        it("Should revert if trying to liquidate a non ended rental", async function () {
            const { users, lessor, proposal, proposalId } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);

            // advance time just before the end of rental
            time.setNextBlockTimestamp(Number(proposal.endTimestampRental) - 1);

            await expect(users[lessor].RentalManager.liquidateRental(rentalId)).to.revertedWith("Rental invalid");
        });

        it("Should revert if trying to liquidate an expired rental but not owned", async function () {
            const { users, lessor, lessee, proposal, proposalId } = await setup(Stage.Renting);

            // accept proposal and create rental
            const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
            const rentalReceipt = await txRental.wait();
            const events = await users[lessor].RentalManager.queryFilter(users[lessor].RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
            const eventLogRent = events[0];
            const rentalId = Number(eventLogRent.args[2]);

            // advance time just before the end of rental
            time.setNextBlockTimestamp(Number(proposal.endTimestampRental) + 1);

            await expect(users[lessee].RentalManager.liquidateRental(rentalId)).to.revertedWith("Not allowed to liquidate");
        });
    });
});