import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verify } from "../utils/verify";
import { networkConfig, developmentChains } from "../helper-hardhat-config";

const deployProposalManager: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log("Deploying ProposalManager and waiting for confirmations...");
  const proposalManager = await deploy("ProposalManager", {
    from: deployer,
    args: [],
    log: true,
    // we need to wait if on a live network so we can verify properly
    waitConfirmations: networkConfig[network.name].blockConfirmations,
  });
  log(`ProposalManager deployed at ${proposalManager.address}`);
  if (
    !developmentChains.includes(network.name) &&
    process.env.ETHERSCAN_API_KEY
  ) {
    await verify(proposalManager.address, []);
  }
};

export default deployProposalManager;
deployProposalManager.tags = ["all", "proposalManager"];