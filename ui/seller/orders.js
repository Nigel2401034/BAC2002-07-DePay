const ordersListEl = document.getElementById("ordersList");
const ordersStatusEl = document.getElementById("ordersStatus");
const ordersCountEl = document.getElementById("ordersCount");
const refreshOrdersBtn = document.getElementById("refreshOrdersBtn");

const API_ORDERS = "http://localhost:5000/api/orders";

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

function shortenAddress(addr) {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
// Seller sales timeline
// ---------------------------------------------------------------------------
const TIMELINE_STEPS = [
  { key: "funded", label: "Paid" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "released", label: "Funds Released" },
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
// Render order card for seller view
// ---------------------------------------------------------------------------
function renderSellerOrder(order) {
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
        </div>`
    )
    .join("");

  // Timeline
  const timelineHtml = buildTimeline(status);

  // Status note
  let statusNote = "";
  if (status === "funded") {
    statusNote = `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">
      Order paid by buyer. Ready to ship.
    </p>`;
  } else if (status === "shipped") {
    statusNote = `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">
      Order shipped. Awaiting delivery confirmation from buyer.
    </p>`;
  } else if (status === "delivered") {
    statusNote = `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">
      Delivered. Awaiting buyer confirmation to release funds.
    </p>`;
  } else if (status === "released") {
    statusNote = `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">
      ✅ Funds released. Transaction complete.
    </p>`;
  } else if (status === "refunded") {
    statusNote = `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">
      ❌ Order refunded. Buyer cancelled or dispute resolved in buyer's favor.
    </p>`;
  }

  // Action buttons
  let actionsHtml = "";
  const msg =
    status === "refunded"
      ? "Refunded to buyer."
      : status === "released"
        ? "Sale complete."
        : status === "delivered"
          ? "Awaiting buyer confirmation…"
          : status === "shipped"
            ? "Awaiting delivery…"
            : "Awaiting payment confirmation…";
  actionsHtml = `<p class="muted">${msg}</p>`;

  return `
    <article class="order-card">
      <div class="order-header">
        <div>
          <h3>Order …${shortId}</h3>
          <p class="muted" style="margin: 0.2rem 0 0;">Buyer: ${shortenAddress(order.buyer)}</p>
        </div>
        <span class="status-badge ${badgeClass}">${status.toUpperCase()}</span>
      </div>

      ${timelineHtml}
      ${statusNote}

      <div class="order-items" style="margin-top:0.6rem">${itemsHtml}</div>

      <div class="order-details">
        <p><strong>Total:</strong> ${Number(order.amountHlusd || 0).toFixed(2)} HLUSD</p>
        <p><strong>Date:</strong> ${formatDate(order.createdAt)}</p>
        <p><strong>Payment TX:</strong> <code>${shortenHash(order.txHash)}</code></p>
        ${order.escrowId != null ? `<p><strong>Escrow ID:</strong> ${order.escrowId}</p>` : ""}
        ${
          order.ipfsCid
            ? `<p><strong>IPFS Record:</strong>
              <a href="${order.ipfsGatewayUrl || `https://gateway.pinata.cloud/ipfs/${order.ipfsCid}`}"
                 target="_blank" rel="noopener noreferrer">
                <code>${shortenCid(order.ipfsCid)}</code>
              </a></p>`
            : ""
        }
        ${
          order.releaseTxHash
            ? `<p><strong>Release TX:</strong> <code>${shortenHash(order.releaseTxHash)}</code></p>`
            : ""
        }
        ${
          order.lastUpdateIpfsCid
            ? `<p><strong>Last Update IPFS:</strong>
              <a href="${order.lastUpdateIpfsGatewayUrl || `https://gateway.pinata.cloud/ipfs/${order.lastUpdateIpfsCid}`}"
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
// Load all orders for the connected seller
// ---------------------------------------------------------------------------
async function loadSellerOrders() {
  const sellerWallet = window.DepayWallet?.getSavedWallet();

  if (!sellerWallet) {
    ordersListEl.innerHTML = '<p class="muted">Please connect your wallet to view your orders.</p>';
    ordersCountEl.textContent = "No wallet connected";
    setStatus("Connect wallet to view your sales.", "error");
    return;
  }

  setStatus("Loading orders…");
  ordersListEl.innerHTML = '<p class="muted">Loading…</p>';

  try {
    const response = await fetch(
      `${API_ORDERS}/seller/${encodeURIComponent(sellerWallet)}`
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch orders");
    }

    const orders = payload.orders || [];

    if (orders.length === 0) {
      ordersListEl.innerHTML = '<p class="muted">No orders yet. Create listings to start selling.</p>';
      ordersCountEl.textContent = "0 orders";
      setStatus("No sales yet.", "ok");
      return;
    }

    ordersCountEl.textContent = `${orders.length} order${orders.length !== 1 ? "s" : ""}`;

    const html = orders.map(renderSellerOrder).join("");
    ordersListEl.innerHTML = `<div class="orders-list">${html}</div>`;

    setStatus("Orders loaded.", "ok");
  } catch (err) {
    setStatus(`Unable to load orders: ${err.message}`, "error");
    ordersListEl.innerHTML =
      '<p class="muted">Try refreshing after backend is running.</p>';
  }
}

refreshOrdersBtn?.addEventListener("click", loadSellerOrders);
document.addEventListener("DOMContentLoaded", loadSellerOrders);
