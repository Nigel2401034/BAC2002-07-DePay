const ordersListEl = document.getElementById("ordersList");
const ordersStatusEl = document.getElementById("ordersStatus");
const ordersCountEl = document.getElementById("ordersCount");
const refreshOrdersBtn = document.getElementById("refreshOrdersBtn");

const API_ORDERS = "http://localhost:5000/api/orders";
const API_ORACLE = "http://localhost:5000/api/oracle";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function setStatus(message, type = "") {
  if (!ordersStatusEl) return;
  ordersStatusEl.textContent = message;
  ordersStatusEl.className = `status ${type}`.trim();
}

function normalizeQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.max(1, parsed);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function shortenHash(hash) {
  if (!hash) return "-";
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function shortenCid(cid) {
  if (!cid) return "-";
  if (cid.length <= 18) return cid;
  return `${cid.slice(0, 10)}…${cid.slice(-6)}`;
}

function getStatusBadgeClass(status) {
  switch (status?.toLowerCase()) {
    case "funded":
      return "badge-funded";
    case "shipped":
      return "badge-shipped";
    case "delivered":
      return "badge-delivered";
    case "released":
      return "badge-released";
    case "refunded":
      return "badge-refunded";
    default:
      return "badge-unknown";
  }
}

// ---------------------------------------------------------------------------
// Tracking timeline
// ---------------------------------------------------------------------------
const TIMELINE_STEPS = [
  { key: "funded", label: "Funded" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "released", label: "Released" },
];

function getTimelineIndex(status) {
  const s = status?.toLowerCase();
  if (s === "refunded") return -1; // special case
  return TIMELINE_STEPS.findIndex((step) => step.key === s);
}

function buildTimeline(status) {
  if (status?.toLowerCase() === "refunded") {
    return `<div class="tracking-timeline" style="margin-bottom:0.4rem">
      <span class="muted" style="font-size:0.83rem">Order was refunded to buyer.</span>
    </div>`;
  }

  const currentIdx = getTimelineIndex(status);
  const stepsHtml = TIMELINE_STEPS.map((step, i) => {
    let cls = "";
    if (i < currentIdx) cls = "ts-done";
    if (i === currentIdx) cls = "ts-active";
    return `<div class="tracking-step ${cls}">
      <span class="tracking-dot"></span>
      <span class="tracking-label">${step.label}</span>
    </div>`;
  }).join("");

  return `<div class="tracking-timeline">${stepsHtml}</div>`;
}

// ---------------------------------------------------------------------------
// Open dispute (buyer action for stuck/problematic orders)
// ---------------------------------------------------------------------------
async function openDisputeFromOrder(orderId, escrowId) {
  if (!window.ethereum) {
    alert("MetaMask is required to open disputes.");
    return;
  }

  if (!window.DepayWallet) {
    alert("Wallet utilities not loaded.");
    return;
  }

  if (!escrowId && escrowId !== 0) {
    alert(
      "Escrow ID not available. Please wait for the transaction to be mined.",
    );
    return;
  }

  const confirmed = confirm(
    "Are you sure you want to open a dispute for this order? " +
      "This should only be used if the order is stuck, damaged, or not received as described.",
  );
  if (!confirmed) return;

  try {
    const buyerWallet = window.DepayWallet.getSavedWallet();
    if (!buyerWallet) throw new Error("Please connect your wallet first.");

    const disputeAddress = window.APP_CONFIG?.disputeAddress;
    if (!disputeAddress) throw new Error("Dispute contract not configured.");

    setStatus("Opening dispute on blockchain…");

    const methodId = "0x1e7f0e93"; // openDispute(uint256)
    const paddedId = BigInt(escrowId).toString(16).padStart(64, "0");

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        { from: buyerWallet, to: disputeAddress, data: methodId + paddedId },
      ],
    });

    setStatus("Saving dispute record…");
    await fetch("http://localhost:5000/api/disputes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        escrowId,
        buyer: buyerWallet,
        txHash,
      }),
    }).catch(() => {});

    setStatus("✅ Dispute opened! Check the Disputes page for updates.", "ok");
    setTimeout(() => loadBuyerOrders(), 2500);
  } catch (err) {
    console.error("openDisputeFromOrder error:", err);
    setStatus(`Failed to open dispute: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Manual buyer release (existing flow — buyer signs confirmReceived)
// ---------------------------------------------------------------------------
async function getEscrowIdFromTxReceipt(txHash) {
  if (!window.ethereum) return null;
  try {
    const escrowAddress = window.APP_CONFIG?.escrowAddress?.toLowerCase();
    if (!escrowAddress) return null;
    const ESCROW_CREATED_TOPIC =
      "0xd32a8e6ee4eaa7ae887d4659a3212bb80cc3691c898c8eae123745080a3dfcd1";

    let receipt = null;
    for (let i = 0; i < 30; i++) {
      receipt = await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      });
      if (receipt) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!receipt?.logs?.length) return null;

    for (const log of receipt.logs) {
      if (
        log.address?.toLowerCase() === escrowAddress &&
        log.topics?.length >= 2 &&
        (log.topics[0] || "").toLowerCase() === ESCROW_CREATED_TOPIC
      ) {
        return BigInt(log.topics[1]).toString();
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function confirmReceivedItem(orderId, txHash) {
  if (!window.ethereum) {
    setStatus("MetaMask is required.", "error");
    return;
  }
  if (!window.DepayWallet) {
    setStatus("Wallet utilities not loaded.", "error");
    return;
  }

  try {
    const buyerWallet = window.DepayWallet.getSavedWallet("buyer");
    if (!buyerWallet) throw new Error("Please connect your wallet first.");

    const escrowAddress = window.APP_CONFIG?.escrowAddress;
    if (!escrowAddress) throw new Error("Escrow contract not configured.");

    setStatus("Fetching order details…");
    const orderRes = await fetch(`${API_ORDERS}/detail/${orderId}`);
    if (!orderRes.ok) throw new Error("Order not found.");
    const orderData = await orderRes.json();
    if (!orderData.success || !orderData.order)
      throw new Error("Invalid order data.");

    let escrowId = orderData.order.escrowId;
    if (!escrowId && escrowId !== 0) {
      setStatus("Waiting for transaction receipt to extract Escrow ID…");
      escrowId = await getEscrowIdFromTxReceipt(txHash);
      if (!escrowId) {
        throw new Error(
          "Could not find Escrow ID. Transaction may not be mined yet — wait a moment and retry.",
        );
      }
      const updateEscrowRes = await fetch(`${API_ORDERS}/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escrowId }),
      });
      if (!updateEscrowRes.ok) {
        const errText = await updateEscrowRes.text();
        console.warn("⚠️ Failed to save escrowId:", errText);
      }
    }

    setStatus("Confirming item received on blockchain…");
    const methodId = "0x27dac36d"; // confirmReceived(uint256)
    const paddedId = BigInt(escrowId).toString(16).padStart(64, "0");
    const releaseTxHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        { from: buyerWallet, to: escrowAddress, data: methodId + paddedId },
      ],
    });

    const updateStatusRes = await fetch(`${API_ORDERS}/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "released", releaseTxHash }),
    });
    if (!updateStatusRes.ok) {
      const errText = await updateStatusRes.text();
      throw new Error(`Released on-chain, but DB update failed: ${errText}`);
    }

    setStatus("✅ Item marked as received! Funds released to seller.", "ok");
    setTimeout(() => loadBuyerOrders(), 2000);
  } catch (err) {
    console.error("confirmReceivedItem error:", err);
    setStatus(`Failed: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Oracle simulate delivery (demo shortcut)
// ---------------------------------------------------------------------------
async function simulateDelivery(orderId) {
  setStatus("⏳ Asking oracle to simulate delivery…");

  try {
    const res = await fetch(`${API_ORACLE}/simulate/${orderId}`, {
      method: "POST",
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Simulation failed");
    }

    setStatus(
      `✅ Oracle released escrow! TX: ${shortenHash(data.releaseTxHash)}`,
      "ok",
    );
    setTimeout(() => loadBuyerOrders(), 2500);
  } catch (err) {
    console.error("simulateDelivery error:", err);
    setStatus(`Simulation failed: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Render order card HTML
// ---------------------------------------------------------------------------
function renderOrder(order) {
  const status = (order.status || "unknown").toLowerCase();
  const badgeClass = getStatusBadgeClass(status);
  const shortId = order._id?.toString?.().slice(-8) || "?";

  const itemsHtml = (order.items || [])
    .map(
      (item) =>
        `<div class="order-item-mini">
          <strong>${item.title}</strong>
          x ${normalizeQuantity(item.quantity)}
          = ${Number(item.amountXsgd || 0).toFixed(2)} HLUSD
        </div>`,
    )
    .join("");

  // Timeline
  const timelineHtml = buildTimeline(status);

  // Oracle status note
  let oracleNote = "";
  if (status === "shipped") {
    oracleNote = `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">
      🤖 Oracle will auto-release funds when delivery is confirmed on-chain.
    </p>`;
  } else if (status === "delivered") {
    oracleNote = `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">
      🤖 Oracle is releasing escrow funds — check back shortly.
    </p>`;
  }

  // Action buttons
  let actionsHtml = "";
  if (status === "funded") {
    actionsHtml = `
      <button type="button" class="btn-open-dispute" data-dispute-btn="${
        order._id
      }" data-escrow-id="${
      order.escrowId || ""
    }" title="Open a dispute if there's an issue with this order">
        ⚖️ Open Dispute
      </button>
      <button type="button" class="btn-simulate" data-simulate-btn="${
        order._id
      }" title="Demo: bypass wait timers and release immediately">
        🤖 Simulate Delivery (Demo)
      </button>`;
  } else if (status === "shipped") {
    actionsHtml = `
      <button type="button" class="btn-open-dispute" data-dispute-btn="${
        order._id
      }" data-escrow-id="${
      order.escrowId || ""
    }" title="Open a dispute if package is stuck">
        ⚖️ Open Dispute
      </button>
      <button type="button" class="btn-simulate" data-simulate-btn="${
        order._id
      }" title="Demo: skip wait and release immediately">
        🤖 Simulate Delivery (Demo)
      </button>`;
  } else {
    const msg =
      status === "released"
        ? "Funds released to seller."
        : status === "refunded"
        ? "Funds refunded to buyer."
        : status === "delivered"
        ? "Awaiting oracle release…"
        : "Pending.";
    actionsHtml = `<p class="muted">${msg}</p>`;
  }

  return `
    <article class="order-card">
      <div class="order-header">
        <h3>Order …${shortId}</h3>
        <span class="status-badge ${badgeClass}">${status.toUpperCase()}</span>
      </div>

      ${timelineHtml}
      ${oracleNote}

      <div class="order-items" style="margin-top:0.6rem">${itemsHtml}</div>

      <div class="order-details">
        <p><strong>Total:</strong> ${Number(order.amountHlusd || 0).toFixed(
          2,
        )} HLUSD</p>
        <p><strong>Date:</strong> ${formatDate(order.createdAt)}</p>
        <p><strong>Payment TX:</strong> <code>${shortenHash(
          order.txHash,
        )}</code></p>
        ${
          order.escrowId != null
            ? `<p><strong>Escrow ID:</strong> ${order.escrowId}</p>`
            : ""
        }
        ${
          order.ipfsCid
            ? `<p><strong>IPFS Record:</strong>
              <a href="${
                order.ipfsGatewayUrl ||
                `https://gateway.pinata.cloud/ipfs/${order.ipfsCid}`
              }"
                 target="_blank" rel="noopener noreferrer">
                <code>${shortenCid(order.ipfsCid)}</code>
              </a></p>`
            : ""
        }
        ${
          order.releaseTxHash
            ? `<p><strong>Release TX:</strong> <code>${shortenHash(
                order.releaseTxHash,
              )}</code></p>`
            : ""
        }
        ${
          order.lastUpdateIpfsCid
            ? `<p><strong>Last Update IPFS:</strong>
              <a href="${
                order.lastUpdateIpfsGatewayUrl ||
                `https://gateway.pinata.cloud/ipfs/${order.lastUpdateIpfsCid}`
              }"
                 target="_blank" rel="noopener noreferrer">
                <code>${shortenCid(order.lastUpdateIpfsCid)}</code>
              </a></p>`
            : ""
        }
      </div>

      <div class="order-actions">${actionsHtml}</div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Load all orders for the connected buyer
// ---------------------------------------------------------------------------
async function loadBuyerOrders() {
  const buyerWallet = window.DepayWallet?.getSavedWallet("buyer");

  if (!buyerWallet) {
    ordersListEl.innerHTML =
      '<p class="muted">Please connect your wallet to view orders.</p>';
    ordersCountEl.textContent = "No wallet connected";
    setStatus("Connect wallet to view your orders.", "error");
    return;
  }

  setStatus("Loading orders…");
  ordersListEl.innerHTML = '<p class="muted">Loading…</p>';

  try {
    const response = await fetch(
      `${API_ORDERS}/buyer/${encodeURIComponent(buyerWallet)}`,
    );
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Failed to fetch orders");
    }

    const orders = payload.orders || [];

    if (orders.length === 0) {
      ordersListEl.innerHTML = '<p class="muted">No orders found.</p>';
      ordersCountEl.textContent = "0 orders";
      setStatus("No active orders. Start by adding items to cart!", "ok");
      return;
    }

    ordersCountEl.textContent = `${orders.length} order${
      orders.length !== 1 ? "s" : ""
    }`;

    const html = orders.map(renderOrder).join("");
    ordersListEl.innerHTML = `<div class="orders-list">${html}</div>`;

    // Attach confirm-received listeners
    ordersListEl.querySelectorAll("[data-confirm-btn]").forEach((btn) => {
      btn.addEventListener("click", () =>
        confirmReceivedItem(btn.dataset.confirmBtn, btn.dataset.txHash || ""),
      );
    });

    // Attach dispute listeners
    ordersListEl.querySelectorAll("[data-dispute-btn]").forEach((btn) => {
      btn.addEventListener("click", () =>
        openDisputeFromOrder(
          btn.dataset.disputeBtn,
          btn.dataset.escrowId || "",
        ),
      );
    });

    // Attach simulate-delivery listeners
    ordersListEl.querySelectorAll("[data-simulate-btn]").forEach((btn) => {
      btn.addEventListener("click", () =>
        simulateDelivery(btn.dataset.simulateBtn),
      );
    });

    setStatus("Orders loaded.", "ok");
  } catch (err) {
    setStatus(`Unable to load orders: ${err.message}`, "error");
    ordersListEl.innerHTML =
      '<p class="muted">Try refreshing after backend is running.</p>';
  }
}

refreshOrdersBtn?.addEventListener("click", loadBuyerOrders);
document.addEventListener("DOMContentLoaded", loadBuyerOrders);
