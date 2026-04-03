const express = require("express");
const db = require("./db");
const { uploadJSONToIPFS } = require("./ipfs");

const router = express.Router();

// POST /api/orders - Create a new escrow order after successful payment
router.post("/", async (req, res) => {
  try {
    const {
      buyerWallet,
      items,
      txHash,
      amountHlusd,
      billingAddress,
      shippingAddress,
      escrowId,
    } = req.body;

    if (
      !buyerWallet ||
      !Array.isArray(items) ||
      items.length === 0 ||
      !txHash ||
      amountHlusd === undefined ||
      amountHlusd === null
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const orderSnapshot = {
      kind: "escrow-order-created",
      txHash: txHash.toLowerCase(),
      buyerWallet: buyerWallet.toLowerCase(),
      amountHlusd,
      items,
      billingAddress: billingAddress || null,
      shippingAddress: shippingAddress || null,
      escrowId: escrowId || null,
      status: "funded",
      recordedAt: new Date().toISOString(),
    };

    const ipfsCid = await uploadJSONToIPFS(
      orderSnapshot,
      `escrow-order-${txHash
        .toLowerCase()
        .replace("0x", "")
        .slice(0, 16)}-${Date.now()}`,
    );

    // Extract seller from first item (all items should be from same seller in typical flow)
    const sellerWallet = items.length > 0 ? items[0].sellerWallet : null;

    const orderData = {
      buyerWallet: buyerWallet.toLowerCase(),
      sellerWallet: sellerWallet ? sellerWallet.toLowerCase() : null,
      items,
      txHash: txHash.toLowerCase(),
      amountHlusd,
      billingAddress,
      shippingAddress,
      escrowId: escrowId || null,
      status: "funded",
      ipfsCid,
      ipfsGatewayUrl: `https://gateway.pinata.cloud/ipfs/${ipfsCid}`,
    };

    const orderId = await db.createEscrowOrder(orderData);

    res.status(201).json({
      success: true,
      message: "Escrow order created successfully",
      orderId: orderId.toString(),
      ipfsCid,
    });
  } catch (error) {
    console.error("❌ Error creating escrow order:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/buyer/:buyer - Get all orders for a buyer wallet
router.get("/buyer/:buyer", async (req, res) => {
  try {
    const orders = await db.getEscrowOrdersByBuyer(req.params.buyer);
    res.json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    console.error("❌ Error fetching buyer orders:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/seller/:seller - Get all orders for a seller wallet
router.get("/seller/:seller", async (req, res) => {
  try {
    const orders = await db.getEscrowOrdersBySeller(req.params.seller);
    res.json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    console.error("❌ Error fetching seller orders:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/detail/:orderId - Get a specific order by ID
router.get("/detail/:orderId", async (req, res) => {
  try {
    const order = await db.getEscrowOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("❌ Error fetching order details:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/orders/:orderId - Update order status
router.put("/:orderId", async (req, res) => {
  try {
    const { status, releaseTxHash, escrowId } = req.body;

    const updateData = {};
    if (status) updateData.status = status;
    if (releaseTxHash) updateData.releaseTxHash = releaseTxHash.toLowerCase();
    if (escrowId !== undefined && escrowId !== null && escrowId !== "") {
      updateData.escrowId = String(escrowId);
    }

    const existingOrder = await db.getEscrowOrderById(req.params.orderId);
    if (!existingOrder) {
      return res
        .status(404)
        .json({ error: "Order not found or no changes made" });
    }

    const updateSnapshot = {
      kind: "escrow-order-updated",
      orderId: req.params.orderId,
      txHash: existingOrder.txHash,
      buyerWallet: existingOrder.buyerWallet,
      previousStatus: existingOrder.status || null,
      nextStatus: updateData.status || existingOrder.status || null,
      releaseTxHash: updateData.releaseTxHash || null,
      escrowId: updateData.escrowId || existingOrder.escrowId || null,
      recordedAt: new Date().toISOString(),
    };

    let updateIpfsCid = null;
    try {
      updateIpfsCid = await uploadJSONToIPFS(
        updateSnapshot,
        `escrow-order-update-${(existingOrder.txHash || "")
          .replace("0x", "")
          .slice(0, 16)}-${Date.now()}`,
      );
      updateData.lastUpdateIpfsCid = updateIpfsCid;
      updateData.lastUpdateIpfsGatewayUrl = `https://gateway.pinata.cloud/ipfs/${updateIpfsCid}`;
    } catch (ipfsError) {
      console.warn(
        "⚠️ IPFS snapshot upload failed, continuing DB update:",
        ipfsError.message,
      );
    }

    const updated = await db.updateEscrowOrder(req.params.orderId, updateData);
    if (!updated) {
      return res
        .status(404)
        .json({ error: "Order not found or no changes made" });
    }

    res.json({
      success: true,
      message: "Order updated successfully",
      updateIpfsCid,
    });
  } catch (error) {
    console.error("❌ Error updating order:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
