import { expect } from "chai";
import { network } from "hardhat";
import { developmentChains } from "../helper-hardhat-config";
import { Stage, setup } from "./utils/setup";

// Only test in developmentChains env
!developmentChains.includes(network.name) ? describe.skip :
describe('Escrow', function () {
    describe('Setup', function () {
        it("Should create all the links", async function () {
            const { RentalManager, Escrow } = await setup(Stage.Retreiving);

            // check all the others contracts of the protocol are linked
            expect(await Escrow.rentalManager()).to.equal(await RentalManager.getAddress());
        });

        it("Lessor approve the Escrow to move his NFTs", async function () {
            const { MyToken721, lessor, Escrow } = await setup(Stage.Retreiving);

            // check the approvement of the lessor
            expect(await MyToken721.isApprovedForAll(lessor, await Escrow.getAddress())).to.equal(true);
        });

        it("Lessee approve the Escrow to move his NFTs", async function () {
            const { MyToken20, lessee, Escrow, collateralAmount } = await setup(Stage.Proposing);

            // check the approvement of the lessor
            expect(await MyToken20.allowance(lessee, await Escrow.getAddress())).to.be.greaterThanOrEqual(collateralAmount);
        });
    });

    describe('Escrow itself', function () {
        it("Should allow the lessor to retreive his NFT after refund", async function () {
            const { users, lessor, listing, MyToken721 } = await setup(Stage.Retreiving);

            // lessor comes and retreive NFT
            await users[lessor].Escrow.retreiveNFT(listing.assetContract, listing.tokenId);
            expect(await MyToken721.ownerOf(listing.tokenId)).to.equal(lessor);
        });

        it("Should revert if other than lessor try to retreive NFT after refund", async function () {
            const { users, lessee, listing, MyToken721, Escrow } = await setup(Stage.Retreiving);

            // lessor comes and retreive NFT
            await expect(users[lessee].Escrow.retreiveNFT(listing.assetContract, listing.tokenId)).to.revertedWith("Not owner of this token");
            // NFT doesn't move
            expect(await MyToken721.ownerOf(listing.tokenId)).to.equal(await Escrow.getAddress());
        });

        it("Should revert if lessor try to retreive a non existant NFT", async function () {
            const { users, lessor, listing, MyToken721, Escrow } = await setup(Stage.Retreiving);

            // lessor comes and retreive wrong NFT
            await expect(users[lessor].Escrow.retreiveNFT(listing.assetContract, Number(listing.tokenId) + 1)).to.reverted;
            // NFT doesn't move
            expect(await MyToken721.ownerOf(listing.tokenId)).to.equal(await Escrow.getAddress());
        });

        it("Should revert if somebody try to use methods only for protocole", async function () {
            const { users, lessor, lessee, listing, MyToken721, Escrow } = await setup(Stage.Retreiving);

            await expect(users[lessor].Escrow.transferNFTFrom(await users[lessor].MyToken721.getAddress(), await Escrow.getAddress(), lessor, listing.tokenId)).to.revertedWith("Only rentalManager is allowed to call");
            await expect(users[lessor].Escrow.safeTransferCollateralFrom(await users[lessee].MyToken20.getAddress(), await Escrow.getAddress(), lessor, listing.collateralAmount)).to.revertedWith("Only rentalManager is allowed to call");
            await expect(users[lessor].Escrow.safeTransferToRenter(lessor, lessee, await users[lessor].MyToken721.getAddress(), listing.tokenId)).to.revertedWith("Only rentalManager is allowed to call");
            await expect(users[lessor].Escrow.payAndReturnCollateral(await users[lessee].MyToken20.getAddress(), lessor, listing.collateralAmount, lessee, 0)).to.revertedWith("Only rentalManager is allowed to call");
            await expect(users[lessor].Escrow.liquidateCollateral(await users[lessee].MyToken20.getAddress(), lessor, listing.collateralAmount)).to.revertedWith("Only rentalManager is allowed to call");
        });


        it("Should withdraw balance after a rent", async function () {
            const { users, lessor, lessee } = await setup(Stage.Retreiving);

            // renter withdraw balance and receive money paied by the renter
            expect(await users[lessee].MyToken20.balanceOf(lessor)).to.equal(0);
            await expect(users[lessor].Escrow.withdrawBalance(await users[lessee].MyToken20.getAddress())).to.emit(users[lessor].Escrow, "BalanceWithdrawed");
            expect(await users[lessee].MyToken20.balanceOf(lessor)).to.be.greaterThan(0);
        });

        it("Should revert if withdrawing empty balance", async function () {
            const { users, lessor, lessee } = await setup(Stage.Retreiving);

            // withdraw so no more money in balance
            await expect(users[lessor].Escrow.withdrawBalance(await users[lessee].MyToken20.getAddress())).to.emit(users[lessor].Escrow, "BalanceWithdrawed");

            await expect(users[lessor].Escrow.withdrawBalance(await users[lessee].MyToken20.getAddress())).to.revertedWith("Not enough found");
        });

        it("Should allow deployer to withdraw protocole founds", async function () {
            const { users, deployer, MyToken20, Escrow } = await setup(Stage.Retreiving);

            // deployer founds empty before withdraw
            expect(await MyToken20.balanceOf(deployer)).to.equal(0);
            await expect(users[deployer].Escrow.withdrawProtocoleBalance(await MyToken20.getAddress())).to.emit(Escrow, "BalanceWithdrawed");
            expect(await MyToken20.balanceOf(deployer)).to.be.greaterThan(0);
        });    

        it("Should revert if withdrawing protocole balance without being deployer", async function () {
            const { users, lessor, MyToken20 } = await setup(Stage.Retreiving);

            // NFT lessor try to withdraw protocole balance
            await expect(users[lessor].Escrow.withdrawProtocoleBalance(await MyToken20.getAddress())).to.revertedWith("Ownable: caller is not the owner");
        });
    });
});