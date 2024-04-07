import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verify } from "../utils/verify";
import { networkConfig, developmentChains } from "../helper-hardhat-config";

const deployEscrow: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log("Deploying Vault and waiting for confirmations...");
  const escrow = await deploy("Vault", {
    from: deployer,
    args: [],
    log: true,
    // we need to wait if on a live network so we can verify properly
    waitConfirmations: networkConfig[network.name].blockConfirmations,
  });
  log(`Vault deployed at ${escrow.address}`);
  if (!developmentChains.includes(network.name)) {
    await verify(escrow.address, []);
  }
};

export default deployEscrow;
deployEscrow.tags = ["all", "vault"];