/**
 * Deploy DePayDispute.sol and wire it into the existing DePayEscrow.
 *
 *   npx hardhat run scripts/deployDispute.js --network helaTestnet
 *
 * Requirements (must be set in .env before running):
 *   ESCROW_ADDRESS          — already-deployed DePayEscrow address
 *   ORDER_TRACKING_ADDRESS  — already-deployed OrderTracking address
 *   PRIVATE_KEY             — deployer / owner wallet (same one that deployed Escrow)
 *
 * After running, copy the printed address into .env:
 *   DISPUTE_ADDRESS=0x...
 */
require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with wallet:", deployer.address);

  const escrowAddress   = process.env.ESCROW_ADDRESS?.trim();
  const trackingAddress = process.env.ORDER_TRACKING_ADDRESS?.trim();

  if (!escrowAddress || !trackingAddress) {
    throw new Error(
      "ESCROW_ADDRESS and ORDER_TRACKING_ADDRESS must both be set in .env"
    );
  }

  // ── Deploy DePayDispute ───────────────────────────────────────────────────
  const Dispute = await hre.ethers.getContractFactory("DePayDispute");
  const dispute = await Dispute.deploy(
    deployer.address,   // owner  (admin who can call adminResolve)
    escrowAddress,      // escrow contract
    trackingAddress     // order tracking contract
  );
  await dispute.waitForDeployment();
  const disputeAddress = await dispute.getAddress();
  console.log("DePayDispute deployed to:", disputeAddress);

  // ── Wire dispute contract into Escrow ─────────────────────────────────────
  const Escrow = await hre.ethers.getContractFactory("DePayEscrow");
  const escrow = Escrow.attach(escrowAddress);

  const tx = await escrow.setDisputeContract(disputeAddress);
  await tx.wait();
  console.log("✅ DePayEscrow.setDisputeContract() done");

  console.log("\n── Next steps ──────────────────────────────────────────────");
  console.log(`Add to .env:  DISPUTE_ADDRESS=${disputeAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
