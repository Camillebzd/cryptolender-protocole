import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "dotenv/config"

const PRIVATE_KEY =
  process.env.PRIVATE_KEY ||
  "";
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  "https://eth-sepolia.g.alchemy.com/v2/your-api-key";
const ETHERSCAN_API_KEY = 
  process.env.ETHERSCAN_API_KEY || 
  "";

const config: HardhatUserConfig = {
  solidity: "0.8.9",
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
        chainId: 31337,
    },
    localhost: {
        chainId: 31337,
    },
    sepolia: {
        chainId: 11155111,
        url: SEPOLIA_RPC_URL,
        accounts: [PRIVATE_KEY],
        saveDeployments: true,
    },
    // mainnet: {
    //     chainId: 1,
    //     url: process.env.MAINNET_RPC_URL,
    //     accounts: [PRIVATE_KEY],
    //     saveDeployments: true,
    // },
},
  namedAccounts: {
    deployer: {
      default: 0,
    },
    // for testing
    lessor: {
      default: 1,
    },
    lessee: {
      default: 2,
    }
  },
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY
    }
  }
};

export default config;
