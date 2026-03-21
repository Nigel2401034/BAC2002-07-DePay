const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying with wallet:", deployer.address);

  const Escrow = await hre.ethers.getContractFactory("DePayEscrow");
  const escrow = await Escrow.deploy(deployer.address);

  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("Escrow deployed to:", escrowAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
