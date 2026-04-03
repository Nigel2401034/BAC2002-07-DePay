const express = require("express");
const db = require("./db");

const router = express.Router();

// POST /api/disputes - Create a new dispute
router.post("/", async (req, res) => {
  try {
    const { orderId, escrowId, buyer, seller, txHash } = req.body;

    if (!orderId || escrowId === undefined || !buyer || !txHash) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: orderId, escrowId, buyer, txHash",
      });
    }

    const disputeData = {
      orderId,
      escrowId: parseInt(escrowId),
      buyer: buyer.toLowerCase(),
      seller: seller ? seller.toLowerCase() : null,
      state: 0, // STATE_NONE initially
      deadline: 0,
      txHash: txHash.toLowerCase(),
    };

    const disputeId = await db.createDispute(disputeData);

    res.status(201).json({
      success: true,
      dispute: {
        _id: disputeId,
        ...disputeData,
      },
    });
  } catch (error) {
    console.error("❌ Error creating dispute:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create dispute",
    });
  }
});

// GET /api/disputes/buyer/:address - Get disputes for a buyer
router.get("/buyer/:address", async (req, res) => {
  try {
    const { address } = req.params;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Buyer address required",
      });
    }

    const disputes = await db.getDisputesByBuyer(address);

    res.json({
      success: true,
      disputes,
    });
  } catch (error) {
    console.error("❌ Error fetching buyer disputes:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch disputes",
    });
  }
});

// GET /api/disputes/seller/:address - Get disputes for a seller
router.get("/seller/:address", async (req, res) => {
  try {
    const { address } = req.params;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Seller address required",
      });
    }

    const disputes = await db.getDisputesBySeller(address);

    res.json({
      success: true,
      disputes,
    });
  } catch (error) {
    console.error("❌ Error fetching seller disputes:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch disputes",
    });
  }
});

// GET /api/disputes/:escrowId - Get dispute by escrow ID
router.get("/:escrowId", async (req, res) => {
  try {
    const { escrowId } = req.params;

    const dispute = await db.getDisputeByEscrowId(escrowId);

    if (!dispute) {
      return res.status(404).json({
        success: false,
        error: "Dispute not found",
      });
    }

    res.json({
      success: true,
      dispute,
    });
  } catch (error) {
    console.error("❌ Error fetching dispute:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch dispute",
    });
  }
});

// PUT /api/disputes/:escrowId - Update dispute
router.put("/:escrowId", async (req, res) => {
  try {
    const { escrowId } = req.params;
    const { state, deadline, sellerResponseTx, buyerCounterTx } = req.body;

    const updateData = {};
    if (state !== undefined) updateData.state = state;
    if (deadline !== undefined) updateData.deadline = deadline;
    if (sellerResponseTx) updateData.sellerResponseTx = sellerResponseTx;
    if (buyerCounterTx) updateData.buyerCounterTx = buyerCounterTx;

    const updated = await db.updateDispute(escrowId, updateData);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Dispute not found",
      });
    }

    const dispute = await db.getDisputeByEscrowId(escrowId);

    res.json({
      success: true,
      dispute,
    });
  } catch (error) {
    console.error("❌ Error updating dispute:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update dispute",
    });
  }
});

module.exports = router;
