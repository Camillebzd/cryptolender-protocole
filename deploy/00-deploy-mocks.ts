import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verify } from "../utils/verify";
import { networkConfig, developmentChains } from "../helper-hardhat-config";
import { ethers } from "hardhat";

const deployMocks: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { deploy, log } = deployments;
  const { deployer, lessor, lessee } = await getNamedAccounts();

  log("----------------------------------------------------");
  // Create the ERC721 mock
  log("Deploying ERC721 tests mock and waiting for confirmations...");
  const myToken721 = await deploy("MyToken721", {
    from: deployer,
    args: [],
    log: false,
    waitConfirmations: networkConfig[network.name].blockConfirmations,
  });
  log(`MyToken721 deployed at ${myToken721.address}`);
  // give a nft to lessor and some to deployer
  const token721 = (await ethers.getContractAt("MyToken721", myToken721.address)).connect(await ethers.getSigner(deployer));
  await token721.safeMint(lessor, 0);
  await token721.safeMint(deployer, 1);
  await token721.safeMint(deployer, 2);
  // Create the ERC20 mock
  // log("Deploying ERC20 tests mock and waiting for confirmations...");
  // const myToken20 = await deploy("MyToken20", {
  //   from: deployer,
  //   args: [],
  //   log: false,
  //   waitConfirmations: networkConfig[network.name].blockConfirmations,
  // });
  // log(`MyToken20 deployed at ${myToken20.address}`);
  // // give a lot of currencies to lessee
  // const token20 = (await ethers.getContractAt("MyToken20", myToken20.address)).connect(await ethers.getSigner(deployer));
  // await token20.mint(lessee, 100000000); // be carefull this data is used in tests
};

export default deployMocks;
deployMocks.tags = ["all", "deployMocks"];