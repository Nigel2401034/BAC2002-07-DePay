/**
 * oracle/oracle-routes.js
 * Express routes mounted at /api/oracle in backend/server.js.
 *
 *   POST /api/oracle/simulate/:orderId
 *     → Immediately triggers the full delivery + escrow release for a demo.
 *       Useful in presentations without waiting for the poll daemon timers.
 *
 *   GET  /api/oracle/status/:orderId
 *     → Returns the current tracking status from MongoDB and (if available)
 *       from the OrderTracking smart contract.
 */

const express = require("express");
const { ObjectId } = require("mongodb");
const { BigInt: _BigInt } = global; // just for clarity — uses native BigInt

const db          = require("../backend/db");
const { getContracts } = require("./chain");

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_LABELS = {
  0: "pending",
  1: "shipped",
  2: "delivered",
};

function contractsAvailable() {
  try {
    getContracts();
    return true;
  } catch {
    return false;
  }
}

async function tryOnChainStatus(escrowId) {
  try {
    const { tracking } = getContracts();
    if (!tracking) return null;
    const result = await tracking.getTracking(BigInt(escrowId));
    if (!result.exists) return null;
    return {
      onChainStatus:    Number(result.status),
      onChainStatusStr: STATUS_LABELS[Number(result.status)] || "unknown",
      onChainUpdatedAt: Number(result.updatedAt),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /api/oracle/simulate/:orderId
// Triggers immediate delivery for demo purposes.
// ---------------------------------------------------------------------------
router.post("/simulate/:orderId", async (req, res) => {
  const { orderId } = req.params;

  // Validate ObjectId
  if (!ObjectId.isValid(orderId)) {
    return res.status(400).json({ error: "Invalid orderId" });
  }

  let order;
  try {
    order = await db.getEscrowOrderById(orderId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  if (!order.escrowId && order.escrowId !== 0) {
    return res.status(400).json({
      error: "Order has no escrowId recorded yet. Wait for the checkout transaction to be mined.",
    });
  }

  if (order.status === "released" || order.status === "refunded") {
    return res.status(400).json({
      error: `Order is already ${order.status} — cannot simulate again.`,
    });
  }

  const escrowId = String(order.escrowId);

  // Require oracle keys to be configured
  if (!contractsAvailable()) {
    return res.status(503).json({
      error: "Oracle not configured. Set ORACLE_PRIVATE_KEY and ESCROW_ADDRESS in .env.",
    });
  }

  let escrow, tracking;
  try {
    ({ escrow, tracking } = getContracts());
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  try {
    // --- Step 1: advance OrderTracking to SHIPPED then DELIVERED (best-effort) ---
    if (tracking) {
      // Check if tracking record exists; create it if not
      const onChain = await tracking.getTracking(BigInt(escrowId));
      if (!onChain.exists) {
        const { ethers } = require("ethers");
        const orderRef = ethers.id(orderId);
        const createTx = await tracking.createTracking(BigInt(escrowId), orderRef);
        await createTx.wait();
      }

      const currentStatus = Number(onChain.exists ? onChain.status : 0);

      if (currentStatus < 1) {
        const tx = await tracking.updateStatus(BigInt(escrowId), 1); // SHIPPED
        await tx.wait();
      }
      if (currentStatus < 2) {
        const tx = await tracking.updateStatus(BigInt(escrowId), 2); // DELIVERED
        await tx.wait();
      }
    }

    // --- Step 2: MongoDB → shipped (informational) ---
    if (order.status === "funded") {
      await db.updateEscrowOrder(orderId, { status: "shipped" });
    }

    // --- Step 3: call oracleRelease on the Escrow contract ---
    const releaseTx = await escrow.oracleRelease(BigInt(escrowId));
    const receipt   = await releaseTx.wait();
    const releaseTxHash = receipt.hash;

    // --- Step 4: MongoDB → released ---
    await db.updateEscrowOrder(orderId, {
      status: "released",
      releaseTxHash: releaseTxHash.toLowerCase(),
    });

    return res.json({
      success:        true,
      message:        "Oracle simulated delivery and released escrow funds to seller.",
      escrowId,
      releaseTxHash,
    });
  } catch (err) {
    console.error(`❌ Oracle simulate failed for order ${orderId}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/oracle/status/:orderId
// Returns tracking info from MongoDB + optionally on-chain.
// ---------------------------------------------------------------------------
router.get("/status/:orderId", async (req, res) => {
  const { orderId } = req.params;

  if (!ObjectId.isValid(orderId)) {
    return res.status(400).json({ error: "Invalid orderId" });
  }

  let order;
  try {
    order = await db.getEscrowOrderById(orderId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  const response = {
    success:    true,
    orderId,
    escrowId:   order.escrowId ?? null,
    dbStatus:   order.status,
    createdAt:  order.createdAt,
    updatedAt:  order.updatedAt,
    txHash:     order.txHash,
    releaseTxHash: order.releaseTxHash ?? null,
    onChain:    null,
  };

  // Enrich with on-chain data if possible
  if (order.escrowId != null && order.escrowId !== "") {
    const onChain = await tryOnChainStatus(order.escrowId);
    if (onChain) response.onChain = onChain;
  }

  return res.json(response);
});

module.exports = router;
