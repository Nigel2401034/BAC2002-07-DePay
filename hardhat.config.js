require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.9",
  networks: {
    helaTestnet: {
      url: "https://testnet-rpc.helachain.com",
      chainId: 666888,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};
