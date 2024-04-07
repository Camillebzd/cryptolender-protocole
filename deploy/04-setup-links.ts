import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const setupLinks: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log("Linking all the contracts of the protocol");
  // retreive deployements
  const listingManagerDeployement = await deployments.get("ListingManager");
  const rentalManagerDeployement = await deployments.get("RentalManager");
  const vaultDeployement = await deployments.get("Vault");
  // instantiate contracts
  const listingManager = (await ethers.getContractAt("ListingManager", listingManagerDeployement.address)).connect(await ethers.getSigner(deployer));
  const rentalManager = (await ethers.getContractAt("RentalManager", rentalManagerDeployement.address)).connect(await ethers.getSigner(deployer));
  const vault = (await ethers.getContractAt("Vault", vaultDeployement.address)).connect(await ethers.getSigner(deployer));
  // setup all the links
  await listingManager.setRentalManager(rentalManagerDeployement.address);
  await listingManager.setVault(vaultDeployement.address);
  await rentalManager.setListingManager(listingManagerDeployement.address);
  await rentalManager.setVault(vaultDeployement.address);
  await vault.setRentalManager(rentalManagerDeployement.address);
};

export default setupLinks;
setupLinks.tags = ["all", "setup"];
setupLinks.runAtTheEnd = true; // force to run after all the other deployement