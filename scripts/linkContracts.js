require("dotenv").config({ override: true });
const hre = require("hardhat");

function requiredEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required in .env`);
  }
  return value;
}

function optionalEnv(name) {
  const value = (process.env[name] || "").trim();
  return value || null;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Linking with wallet:", deployer.address);

  const escrowAddress = requiredEnv("ESCROW_ADDRESS");
  const disputeAddress = requiredEnv("DISPUTE_ADDRESS");
  const trackingAddress = optionalEnv("ORDER_TRACKING_ADDRESS");

  if (!hre.ethers.isAddress(escrowAddress)) {
    throw new Error("ESCROW_ADDRESS is not a valid address");
  }
  if (!hre.ethers.isAddress(disputeAddress)) {
    throw new Error("DISPUTE_ADDRESS is not a valid address");
  }
  if (trackingAddress && !hre.ethers.isAddress(trackingAddress)) {
    throw new Error("ORDER_TRACKING_ADDRESS is not a valid address");
  }

  const Escrow = await hre.ethers.getContractFactory("DePayEscrow");
  const escrow = Escrow.attach(escrowAddress);

  const currentDispute = await escrow.disputeContract();
  if (currentDispute.toLowerCase() !== disputeAddress.toLowerCase()) {
    const setDisputeTx = await escrow.setDisputeContract(disputeAddress);
    await setDisputeTx.wait();
    console.log("✅ Escrow linked to dispute contract:", disputeAddress);
  } else {
    console.log("ℹ️ Escrow dispute contract already set:", disputeAddress);
  }

  const oraclePk = optionalEnv("ORACLE_PRIVATE_KEY");
  if (oraclePk) {
    const oracleWallet = new hre.ethers.Wallet(oraclePk);
    const oracleAddress = oracleWallet.address;

    const currentEscrowOracle = await escrow.oracle();
    if (currentEscrowOracle.toLowerCase() !== oracleAddress.toLowerCase()) {
      const setEscrowOracleTx = await escrow.setOracle(oracleAddress);
      await setEscrowOracleTx.wait();
      console.log("✅ Escrow oracle set:", oracleAddress);
    } else {
      console.log("ℹ️ Escrow oracle already set:", oracleAddress);
    }

    if (trackingAddress) {
      const Tracking = await hre.ethers.getContractFactory("OrderTracking");
      const tracking = Tracking.attach(trackingAddress);
      const currentTrackingOracle = await tracking.oracle();
      if (currentTrackingOracle.toLowerCase() !== oracleAddress.toLowerCase()) {
        const setTrackingOracleTx = await tracking.setOracle(oracleAddress);
        await setTrackingOracleTx.wait();
        console.log("✅ Tracking oracle set:", oracleAddress);
      } else {
        console.log("ℹ️ Tracking oracle already set:", oracleAddress);
      }
    }
  } else {
    console.log("ℹ️ ORACLE_PRIVATE_KEY not set; oracle linking skipped.");
  }

  console.log("\nDone. Contract linking is complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
