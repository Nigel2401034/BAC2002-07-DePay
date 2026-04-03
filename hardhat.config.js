require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ override: true });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    helaTestnet: {
      url: "https://testnet-rpc.helachain.com",
      chainId: 666888,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};
