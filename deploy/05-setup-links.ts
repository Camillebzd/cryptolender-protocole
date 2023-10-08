import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verify } from "../utils/verify";
import { networkConfig, developmentChains } from "../helper-hardhat-config";
import { ethers } from "hardhat";

const setupLinks: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = network.config.chainId;

  log("----------------------------------------------------");
  log("Linking all the contracts of the protocol");
  // retreive deployements
  const listingManagerDeployement = await deployments.get("ListingManager");
  const proposalManagerDeployement = await deployments.get("ProposalManager");
  const rentalManagerDeployement = await deployments.get("RentalManager");
  const escrowDeployement = await deployments.get("Escrow");
  // instantiate contracts
  const listingManager = (await ethers.getContractAt("ListingManager", listingManagerDeployement.address)).connect(await ethers.getSigner(deployer));
  const proposalManager = (await ethers.getContractAt("ProposalManager", proposalManagerDeployement.address)).connect(await ethers.getSigner(deployer));
  const rentalManager = (await ethers.getContractAt("RentalManager", rentalManagerDeployement.address)).connect(await ethers.getSigner(deployer));
  const escrow = (await ethers.getContractAt("Escrow", escrowDeployement.address)).connect(await ethers.getSigner(deployer));
  // setup all the links
  await listingManager.setProposalManager(proposalManagerDeployement.address);
  await listingManager.setRentalManager(rentalManagerDeployement.address);
  await listingManager.setEscrow(escrowDeployement.address);
  await proposalManager.setListingManager(listingManagerDeployement.address);
  await proposalManager.setRentalManager(rentalManagerDeployement.address);
  await proposalManager.setEscrow(escrowDeployement.address);
  // ! erc20 not set -> handle it with an ERC20 manager
  if (chainId === 31337) {
    await proposalManager.setERC20((await deployments.get("MyToken20")).address);
  }
  await rentalManager.setListingManager(listingManagerDeployement.address);
  await rentalManager.setProposalManager(proposalManagerDeployement.address);
  await rentalManager.setEscrow(escrowDeployement.address);
  // ! erc20 not set -> handle it with an ERC20 manager
  if (chainId === 31337) {
    await rentalManager.setERC20((await deployments.get("MyToken20")).address);
  }
  await escrow.setRentalManager(rentalManagerDeployement.address);
};

export default setupLinks;
setupLinks.tags = ["all", "setup"];
setupLinks.runAtTheEnd = true; // force to run after all the other deployement