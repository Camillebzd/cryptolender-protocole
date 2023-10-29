import { BaseContract, EventLog } from "ethers";
import { deployments, ethers, getNamedAccounts } from "hardhat";
import { ListingManager, ProposalManager } from "../../typechain-types";

export async function setupUsers<T extends {[contractName: string]: BaseContract}>(
	addresses: string[],
	contracts: T
) {
	const users: Record<string, T> = {};
	for (const address of addresses) {
		users[address] = (await setupUser(address, contracts));
	}
	return users;
}

export async function setupUser<T extends {[contractName: string]: BaseContract}>(
	address: string,
	contracts: T
): Promise<T> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const user: any = {};
	for (const key of Object.keys(contracts)) {
		user[key] = contracts[key].connect(await ethers.getSigner(address));
	}
	return user as T;
}

export enum Stage {
    Listing,
    Proposing,
    Renting,
    Retreiving
}

// Fixture for the tests of the protocole
export const setup = deployments.createFixture(async (hre, stage: Stage | undefined) => {
    const { deployer, lessor, lessee } = await getNamedAccounts();
    await deployments.fixture(['all']);
    const contracts = {
        ListingManager: await ethers.getContractAt("ListingManager", (await deployments.get("ListingManager")).address),
        ProposalManager: await ethers.getContractAt("ProposalManager", (await deployments.get("ProposalManager")).address),
        RentalManager: await ethers.getContractAt("RentalManager", (await deployments.get("RentalManager")).address),
        Escrow: await ethers.getContractAt("Escrow", (await deployments.get("Escrow")).address),
        MyToken721: await ethers.getContractAt("MyToken721", (await deployments.get("MyToken721")).address),
        MyToken20: await ethers.getContractAt("MyToken20", (await deployments.get("MyToken20")).address),
    }
    const users = await setupUsers([deployer, lessor, lessee], contracts); // contracts with entities connected
    // (Step 1 of process) lessor approve the escrow on nft contract
    await users[lessor].MyToken721.setApprovalForAll(await contracts.Escrow.getAddress(), true);
    // (Step 3 of process) lessee approve the escrow on the crypto contract 
    const collateralAmount = 40000;
    await users[lessee].MyToken20.approve(await contracts.Escrow.getAddress(), collateralAmount);
    // Usefull data
    const commissionRate = 5;
    await users[deployer].Escrow.setCommissionRate(commissionRate);
    const listing: ListingManager.ListingParametersStruct = {
        assetContract: await contracts.MyToken721.getAddress(),
        tokenId: 0,
        collateralAmount: collateralAmount,
        startTimestamp: Date.now(),
        endTimestamp: new Date().setDate(new Date().getDate() + 7),
        pricePerDay: 300,
        comment: "No comment"
    };
    const listingUpdating: ListingManager.ListingParametersStruct = {
        assetContract: await contracts.MyToken721.getAddress(),
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
    // if stage is after listing then create a listing
    let listingId: number = -1;
    if (stage != undefined && stage > Stage.Listing) {
        // create new listing
        const tx = await users[lessor].ListingManager.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        listingId = Number(eventLog.args[2]);
    }
    // if stage is after proposing then create a proposal
    let proposalId: number = -1;
    if (stage != undefined && stage > Stage.Proposing) {
        // create new proposal
        const tx = await users[lessee].ProposalManager.createProposal(listingId, proposal);
        const eventLogProp = (await tx.wait())?.logs[0] as EventLog;
        proposalId = Number(eventLogProp.args[1]);
    }

    // if stage is after renting so accept proposal then refund it
    if (stage != undefined && stage > Stage.Renting) {
        // accept proposal and create rental
        const txRental = await users[lessor].ProposalManager.acceptProposal(proposalId);
        const rentalReceipt = await txRental.wait();
        const events = await contracts.RentalManager.queryFilter(contracts.RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);
        // approve the contract
        users[lessee].MyToken721.setApprovalForAll(await contracts.Escrow.getAddress(), true);
        // return the nft and retreive collateral
        await users[lessee].RentalManager.refundRental(rentalId);
    }

    return {
        ...contracts,
        deployer,
        lessor,
        lessee,
        users,
        collateralAmount,
        commissionRate,
        listing,
        listingUpdating,
        proposal,
        proposalUpdating,
        listingId,
        proposalId
    };
});
