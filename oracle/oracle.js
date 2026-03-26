/**
 * oracle/oracle.js
 * Mock delivery oracle for DePay.
 *
 * Run from the project root:
 *   node oracle/oracle.js
 *
 * What it does:
 *   1. Polls MongoDB every ORACLE_POLL_INTERVAL ms for funded/shipped orders
 *      that have an escrowId recorded.
 *   2. Simulates a delivery pipeline:
 *        funded  --[SHIP_DELAY]--> shipped  --[DELIVER_DELAY]--> oracleRelease
 *   3. Calls oracleRelease() on DePayEscrow when an order is delivered.
 *   4. Keeps OrderTracking.sol in sync (if ORDER_TRACKING_ADDRESS is set).
 *   5. Updates MongoDB status via the backend REST API after each step.
 *
 * Env vars (add to .env):
 *   ORACLE_PRIVATE_KEY        — wallet authorised as oracle on the contracts
 *   ESCROW_ADDRESS            — deployed DePayEscrow contract address
 *   ORDER_TRACKING_ADDRESS    — deployed OrderTracking contract address (optional)
 *   BACKEND_URL               — default http://localhost:5000
 *   ORACLE_POLL_INTERVAL      — ms between polls, default 15000
 *   ORACLE_SHIP_DELAY         — ms after funded before marking shipped, default 30000
 *   ORACLE_DELIVER_DELAY      — ms after shipped before releasing, default 60000
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { MongoClient, ObjectId } = require("mongodb");
const axios   = require("axios");
const { ethers } = require("ethers");
const { getContracts } = require("./chain");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MONGO_URI        = process.env.MONGODB_URI || "mongodb://root:password@localhost:27018/listings";
const BACKEND_URL      = (process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
const POLL_INTERVAL_MS = parseInt(process.env.ORACLE_POLL_INTERVAL  || "15000", 10);
const SHIP_DELAY_MS    = parseInt(process.env.ORACLE_SHIP_DELAY     || "30000", 10);
const DELIVER_DELAY_MS = parseInt(process.env.ORACLE_DELIVER_DELAY  || "60000", 10);

const DB_NAME      = "listings";
const ORDERS_COLL  = "escrow_orders";

// ---------------------------------------------------------------------------
// In-memory state: orderId → { status: "funded"|"shipped", since: timestamp }
// ---------------------------------------------------------------------------
const trackedOrders = new Map();

// Guards against processing the same order concurrently across two poll ticks
const inProgress = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function updateOrderViaAPI(orderId, status, extra = {}) {
  const body = { status, ...extra };
  const url  = `${BACKEND_URL}/api/orders/${orderId}`;
  try {
    const res = await axios.put(url, body, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    throw new Error(`Backend PUT /api/orders/${orderId} failed: ${msg}`);
  }
}

async function tryCreateTracking(tracking, escrowId, orderId) {
  if (!tracking) return;
  try {
    const orderRef = ethers.id(orderId); // keccak256 of the orderId string → bytes32
    const tx = await tracking.createTracking(BigInt(escrowId), orderRef);
    await tx.wait();
    console.log(`   ⛓  createTracking(${escrowId}) mined: ${tx.hash}`);
  } catch (err) {
    // AlreadyExists is fine — oracle restarted or duplicate call
    if (err?.reason === "AlreadyExists" || err?.message?.includes("AlreadyExists")) {
      console.log(`   ℹ️  Tracking for escrow ${escrowId} already exists on-chain`);
    } else {
      console.warn(`   ⚠️  createTracking(${escrowId}) failed: ${err.message}`);
    }
  }
}

async function tryUpdateTrackingStatus(tracking, escrowId, newStatus) {
  if (!tracking) return;
  try {
    const tx = await tracking.updateStatus(BigInt(escrowId), newStatus);
    await tx.wait();
    console.log(`   ⛓  updateStatus(${escrowId}, ${newStatus}) mined: ${tx.hash}`);
  } catch (err) {
    console.warn(`   ⚠️  updateStatus(${escrowId}, ${newStatus}) failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Core state-machine step handlers
// ---------------------------------------------------------------------------
async function shipOrder(orderId, escrowId, tracking) {
  console.log(`🚚 Shipping order ${orderId} (escrowId=${escrowId})`);
  await tryUpdateTrackingStatus(tracking, escrowId, 1 /* SHIPPED */);
  await updateOrderViaAPI(orderId, "shipped");
  console.log(`   ✅ MongoDB status → shipped`);
}

async function deliverOrder(orderId, escrowId, escrow, tracking) {
  console.log(`📦 Delivering order ${orderId} (escrowId=${escrowId})`);
  await tryUpdateTrackingStatus(tracking, escrowId, 2 /* DELIVERED */);

  // Release escrow funds to seller
  console.log(`   🔓 Calling oracleRelease(${escrowId})…`);
  const tx = await escrow.oracleRelease(BigInt(escrowId));
  const receipt = await tx.wait();
  console.log(`   ⛓  oracleRelease mined: ${receipt.hash}`);

  await updateOrderViaAPI(orderId, "released", { releaseTxHash: receipt.hash });
  console.log(`   ✅ MongoDB status → released`);
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------
async function poll(ordersCollection, { escrow, tracking }) {
  let activeOrders;
  try {
    activeOrders = await ordersCollection
      .find({
        status:   { $in: ["funded", "shipped"] },
        escrowId: { $exists: true, $ne: null, $nin: [null, ""] },
      })
      .toArray();
  } catch (err) {
    console.error(`❌ MongoDB query failed: ${err.message}`);
    return;
  }

  if (activeOrders.length === 0) return;

  console.log(`🔍 Poll — ${activeOrders.length} active order(s)`);

  for (const order of activeOrders) {
    const orderId  = order._id.toString();
    const escrowId = String(order.escrowId);

    if (inProgress.has(orderId)) continue;

    const now     = Date.now();
    const tracked = trackedOrders.get(orderId);

    if (!tracked) {
      // First time we see this order — register it in our state map
      trackedOrders.set(orderId, { status: order.status, since: now });

      // Register on-chain tracking if order is freshly funded
      if (order.status === "funded") {
        console.log(`📋 New funded order tracked: ${orderId} (escrowId=${escrowId})`);
        await tryCreateTracking(tracking, escrowId, orderId);
      } else {
        console.log(`📋 Resuming ${order.status} order: ${orderId} (escrowId=${escrowId})`);
      }
      continue; // Wait for next poll tick to check elapsed time
    }

    const elapsed = now - tracked.since;

    if (tracked.status === "funded" && elapsed >= SHIP_DELAY_MS) {
      inProgress.add(orderId);
      try {
        await shipOrder(orderId, escrowId, tracking);
        trackedOrders.set(orderId, { status: "shipped", since: now });
      } catch (err) {
        console.error(`❌ shipOrder(${orderId}) failed: ${err.message}`);
      } finally {
        inProgress.delete(orderId);
      }

    } else if (tracked.status === "shipped" && elapsed >= DELIVER_DELAY_MS) {
      inProgress.add(orderId);
      try {
        await deliverOrder(orderId, escrowId, escrow, tracking);
        trackedOrders.delete(orderId);
      } catch (err) {
        console.error(`❌ deliverOrder(${orderId}) failed: ${err.message}`);
        // Leave in trackedOrders so the next poll retries
      } finally {
        inProgress.delete(orderId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.ORACLE_PRIVATE_KEY) {
    console.error("❌ ORACLE_PRIVATE_KEY is not set in .env — exiting.");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🤖 DePay Oracle");
  console.log("=".repeat(60));
  console.log(`   Poll interval : ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`   Ship delay    : ${SHIP_DELAY_MS / 1000}s`);
  console.log(`   Deliver delay : ${DELIVER_DELAY_MS / 1000}s`);
  console.log(`   Backend URL   : ${BACKEND_URL}`);
  console.log("=".repeat(60) + "\n");

  // Initialise blockchain connections
  let escrow, tracking;
  try {
    ({ escrow, tracking } = getContracts());
    const oracleAddr = await escrow.runner.getAddress();
    console.log(`🔑 Oracle wallet : ${oracleAddr}`);
    console.log(`📄 Escrow        : ${process.env.ESCROW_ADDRESS}`);
    if (process.env.ORDER_TRACKING_ADDRESS) {
      console.log(`📄 OrderTracking : ${process.env.ORDER_TRACKING_ADDRESS}`);
    }
    console.log();
  } catch (err) {
    console.error(`❌ Chain setup failed: ${err.message}`);
    process.exit(1);
  }

  // Connect to MongoDB
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error(`❌ MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }

  const ordersCollection = client.db(DB_NAME).collection(ORDERS_COLL);

  // Run immediately, then on interval
  await poll(ordersCollection, { escrow, tracking });
  const timer = setInterval(() => poll(ordersCollection, { escrow, tracking }), POLL_INTERVAL_MS);

  process.on("SIGINT", async () => {
    console.log("\n⏹️  Oracle shutting down…");
    clearInterval(timer);
    await client.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("❌ Oracle fatal error:", err);
  process.exit(1);
});
