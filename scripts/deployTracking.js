/**
 * Deploy OrderTracking.sol and wire the oracle wallet into both contracts.
 *
 *   npx hardhat run scripts/deployTracking.js --network helaTestnet
 *
 * After running, copy the printed OrderTracking address into .env:
 *   ORDER_TRACKING_ADDRESS=0x...
 *
 * ORACLE_PRIVATE_KEY must already be set in .env.
 */
require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with wallet:", deployer.address);

  // ── Deploy OrderTracking ─────────────────────────────────────────────────
  const OrderTracking = await hre.ethers.getContractFactory("OrderTracking");
  const tracking = await OrderTracking.deploy(deployer.address);
  await tracking.waitForDeployment();
  const trackingAddress = await tracking.getAddress();
  console.log("OrderTracking deployed to:", trackingAddress);

  // ── Derive oracle wallet address from ORACLE_PRIVATE_KEY ─────────────────
  if (!process.env.ORACLE_PRIVATE_KEY) {
    console.warn("⚠️  ORACLE_PRIVATE_KEY not set — skipping setOracle() calls.");
    console.log("\nManually call setOracle() on both contracts with your oracle address.");
    return;
  }

  const oracleWallet = new hre.ethers.Wallet(process.env.ORACLE_PRIVATE_KEY);
  console.log("Oracle wallet address:", oracleWallet.address);

  // ── setOracle on OrderTracking ────────────────────────────────────────────
  const setTrackingOracle = await tracking.setOracle(oracleWallet.address);
  await setTrackingOracle.wait();
  console.log("✅ OrderTracking.setOracle() done");

  // ── setOracle on existing DePayEscrow ─────────────────────────────────────
  const escrowAddress = process.env.ESCROW_ADDRESS;
  if (!escrowAddress) {
    console.warn("⚠️  ESCROW_ADDRESS not set — skipping Escrow.setOracle().");
  } else {
    const Escrow = await hre.ethers.getContractFactory("DePayEscrow");
    const escrow = Escrow.attach(escrowAddress);
    const setEscrowOracle = await escrow.setOracle(oracleWallet.address);
    await setEscrowOracle.wait();
    console.log("✅ DePayEscrow.setOracle() done");
  }

  console.log("\n── Next steps ──────────────────────────────────────────────");
  console.log(`Add to .env:  ORDER_TRACKING_ADDRESS=${trackingAddress}`);
  console.log("Then start the oracle:  node oracle/oracle.js");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
