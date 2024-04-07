import { BaseContract, EventLog } from "ethers";
import { deployments, ethers, getNamedAccounts } from "hardhat";
import { ListingManager } from "../../typechain-types";

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

// Stages during the protocol
export enum Stage {
    Listing,
    Renting,
    Retreiving
}

// Fixture for the tests of the protocol
export const setup = deployments.createFixture(async (hre, stage: Stage | undefined) => {
    const { deployer, lessor, lessee } = await getNamedAccounts();
    await deployments.fixture(['all']); // redeploy all the contracts in deploy/ folder
    const contracts = {
        ListingManager: await ethers.getContractAt("ListingManager", (await deployments.get("ListingManager")).address),
        RentalManager: await ethers.getContractAt("RentalManager", (await deployments.get("RentalManager")).address),
        Vault: await ethers.getContractAt("Vault", (await deployments.get("Vault")).address),
        MyToken721: await ethers.getContractAt("MyToken721", (await deployments.get("MyToken721")).address),
    }
    const users = await setupUsers([deployer, lessor, lessee], contracts); // contracts with entities connected
    // (Step 1 of process) lessor approve the vault on nft contract
    await users[lessor].MyToken721.setApprovalForAll(await contracts.Vault.getAddress(), true);
    // Usefull data
    const collateralAmount = ethers.parseEther("0.01");
    // WARNING: timestamps should be in seconds because solidity work with seconds
    const listing: ListingManager.ListingParametersStruct = {
        assetContract: await contracts.MyToken721.getAddress(),
        tokenId: 0,
        collateralAmount: collateralAmount,
        pricePerDay: 300,
        startTimestamp: Math.floor(Date.now() / 1000), // timestamp in second
        endTimestamp: Math.floor((new Date().setDate(new Date().getDate() + 7)) / 1000), // timestamp in second
        duration: 7 * 60 * 60, // 7 days duration in seconds 
        isProRated: true
    };
    const listingUpdating: ListingManager.ListingParametersStruct = {
        assetContract: await contracts.MyToken721.getAddress(),
        tokenId: 0,
        collateralAmount: collateralAmount,
        pricePerDay: 100,
        startTimestamp: Math.floor(Date.now() / 1000), // timestamp in second
        endTimestamp: Math.floor((new Date().setDate(new Date().getDate() + 7)) / 1000), // timestamp in second
        duration: 10 * 60 * 60, // 10 days duration in seconds 
        isProRated: true
    };
    // if stage is after listing then create a listing
    let listingId: number = -1;
    if (stage != undefined && stage > Stage.Listing) {
        // create new listing
        const tx = await users[lessor].ListingManager.createListing(listing);
        const eventLog = (await tx.wait())?.logs[0] as EventLog;
        listingId = Number(eventLog.args[2]);
    }

    // if stage is after renting so accept listing then refund it
    if (stage != undefined && stage > Stage.Renting) {
        // accept proposal and create rental
        const txRental = await users[lessor].RentalManager.createRental(listingId);
        const rentalReceipt = await txRental.wait();
        const events = await contracts.RentalManager.queryFilter(contracts.RentalManager.filters.RentalCreated, rentalReceipt?.blockNumber, rentalReceipt?.blockNumber);
        const eventLogRent = events[0];
        const rentalId = Number(eventLogRent.args[2]);
        // approve the contract
        users[lessee].MyToken721.setApprovalForAll(await contracts.Vault.getAddress(), true);
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
        listing,
        listingUpdating,
        listingId,
    };
});
