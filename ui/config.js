window.APP_CONFIG = {
  dappName: "DePay",
  currency: "HLUSD",
  expectedChainIdHex: "0xa2d08",
  escrowAddress: "0xf73dc38C849a842224898fE48F76B0F4C62d2C12",
  disputeAddress: "0x...", // Update with your deployed dispute contract address
  trackingAddress: "0x...", // Update with your deployed tracking contract address
  ipfsGatewayBase: "https://gateway.pinata.cloud/ipfs/",
  pinataJsonEndpoint: "https://api.pinata.cloud/pinning/pinJSONToIPFS",
  pinataFileEndpoint: "https://api.pinata.cloud/pinning/pinFileToIPFS",
};

// For localhost development, override chain ID
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  window.APP_CONFIG.expectedChainIdHex = "0x7a69"; // Hardhat chain ID (31337 in decimal)
}
