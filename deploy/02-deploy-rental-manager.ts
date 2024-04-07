import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verify } from "../utils/verify";
import { networkConfig, developmentChains } from "../helper-hardhat-config";

const deployRentalManager: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log("Deploying RentalManager and waiting for confirmations...");
  const rentalManager = await deploy("RentalManager", {
    from: deployer,
    args: [],
    log: true,
    // we need to wait if on a live network so we can verify properly
    waitConfirmations: networkConfig[network.name].blockConfirmations,
  });
  log(`RentalManager deployed at ${rentalManager.address}`);
  if (!developmentChains.includes(network.name)) {
    await verify(rentalManager.address, []);
  }
};

export default deployRentalManager;
deployRentalManager.tags = ["all", "rentalManager"];