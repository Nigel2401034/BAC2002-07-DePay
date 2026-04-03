const disputesListEl = document.getElementById("disputesList");
const disputesStatusEl = document.getElementById("disputesStatus");
const disputesCountEl = document.getElementById("disputesCount");
const refreshDisputesBtn = document.getElementById("refreshDisputesBtn");

const API_DISPUTES = "http://localhost:5000/api/disputes";
const API_ORDERS = "http://localhost:5000/api/orders";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function setStatus(message, type = "") {
  if (!disputesStatusEl) return;
  disputesStatusEl.textContent = message;
  disputesStatusEl.className = `status ${type}`.trim();
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

function shortenAddress(addr) {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Dispute state constants (from contract)
const DISPUTE_STATES = {
  0: { label: "None", badge: "badge-unknown", display: "No Dispute" },
  1: {
    label: "Awaiting Seller",
    badge: "badge-warn",
    display: "Awaiting Seller Response",
  },
  2: {
    label: "Awaiting Buyer",
    badge: "badge-warn",
    display: "Awaiting Your Counter",
  },
  3: {
    label: "Awaiting Admin",
    badge: "badge-critical",
    display: "Pending Admin Decision",
  },
  4: { label: "Resolved", badge: "badge-resolved", display: "Resolved" },
};

function getDisputeStateBadgeClass(state) {
  const info = DISPUTE_STATES[state] || DISPUTE_STATES[0];
  return info.badge;
}

function getDisputeStateDisplay(state) {
  const info = DISPUTE_STATES[state] || DISPUTE_STATES[0];
  return info.display;
}

// Deadline countdown
function getDeadlineStatus(deadline) {
  if (!deadline || deadline === 0) {
    return { text: "No deadline", color: "muted" };
  }

  const now = Math.floor(Date.now() / 1000);
  const remaining = deadline - now;

  if (remaining <= 0) {
    return { text: "Deadline passed", color: "danger" };
  }

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (hours > 0) {
    return { text: `${hours}h ${minutes}m remaining`, color: "warn" };
  } else {
    return { text: `${minutes}m remaining`, color: "danger" };
  }
}

// ---------------------------------------------------------------------------
// Open dispute (buyer action)
// ---------------------------------------------------------------------------
async function openDispute(orderId, escrowId) {
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

    const disputeAddress = window.APP_CONFIG?.disputeAddress;
    if (!disputeAddress) throw new Error("Dispute contract not configured.");

    setStatus("Opening dispute on blockchain…");

    const methodId = "0x27d00fb0"; // openDispute(uint256)
    const paddedId = BigInt(escrowId).toString(16).padStart(64, "0");

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        { from: buyerWallet, to: disputeAddress, data: methodId + paddedId },
      ],
    });

    setStatus("Saving dispute record…");
    await fetch(`${API_DISPUTES}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        escrowId,
        buyer: buyerWallet,
        txHash,
      }),
    }).catch(() => {});

    await fetch(`${API_ORDERS}/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "refunded" }),
    }).catch(() => {});

    setStatus("✅ Dispute opened. Order cancelled and buyer refunded.", "ok");
    setTimeout(() => loadBuyerDisputes(), 2000);
  } catch (err) {
    console.error("openDispute error:", err);
    setStatus(`Failed: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Seller respond to dispute
// ---------------------------------------------------------------------------
async function sellerRespond(escrowId) {
  if (!window.ethereum) {
    setStatus("MetaMask is required.", "error");
    return;
  }

  try {
    const sellerWallet = window.DepayWallet.getSavedWallet("seller");
    if (!sellerWallet) throw new Error("Please connect your wallet first.");

    const disputeAddress = window.APP_CONFIG?.disputeAddress;
    if (!disputeAddress) throw new Error("Dispute contract not configured.");

    setStatus("Responding to dispute on blockchain…");

    const methodId = "0x7aa3a1df"; // sellerRespond(uint256)
    const paddedId = BigInt(escrowId).toString(16).padStart(64, "0");

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        { from: sellerWallet, to: disputeAddress, data: methodId + paddedId },
      ],
    });

    setStatus(`✅ Response submitted! TX: ${shortenHash(txHash)}`, "ok");
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    console.error("sellerRespond error:", err);
    setStatus(`Failed: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Buyer counter to dispute
// ---------------------------------------------------------------------------
async function buyerCounter(escrowId) {
  if (!window.ethereum) {
    setStatus("MetaMask is required.", "error");
    return;
  }

  try {
    const buyerWallet = window.DepayWallet.getSavedWallet("buyer");
    if (!buyerWallet) throw new Error("Please connect your wallet first.");

    const disputeAddress = window.APP_CONFIG?.disputeAddress;
    if (!disputeAddress) throw new Error("Dispute contract not configured.");

    setStatus("Submitting counter on blockchain…");

    const methodId = "0x5b3a47b5"; // buyerCounter(uint256)
    const paddedId = BigInt(escrowId).toString(16).padStart(64, "0");

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        { from: buyerWallet, to: disputeAddress, data: methodId + paddedId },
      ],
    });

    setStatus(`✅ Counter submitted! TX: ${shortenHash(txHash)}`, "ok");
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    console.error("buyerCounter error:", err);
    setStatus(`Failed: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Enforce deadline (anyone can call)
// ---------------------------------------------------------------------------
async function enforceDeadline(escrowId) {
  if (!window.ethereum) {
    setStatus("MetaMask is required.", "error");
    return;
  }

  try {
    const wallet =
      window.DepayWallet.getSavedWallet("buyer") ||
      window.DepayWallet.getSavedWallet("seller");
    if (!wallet) throw new Error("Please connect your wallet first.");

    const disputeAddress = window.APP_CONFIG?.disputeAddress;
    if (!disputeAddress) throw new Error("Dispute contract not configured.");

    setStatus("Enforcing deadline on blockchain…");

    const methodId = "0xf91ab671"; // enforceDeadline(uint256)
    const paddedId = BigInt(escrowId).toString(16).padStart(64, "0");

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: wallet, to: disputeAddress, data: methodId + paddedId }],
    });

    setStatus(`✅ Deadline enforced! TX: ${shortenHash(txHash)}`, "ok");
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    console.error("enforceDeadline error:", err);
    setStatus(`Failed: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Render dispute card
// ---------------------------------------------------------------------------
function renderDispute(dispute) {
  const state = dispute.state || 0;
  const stateDisplay = getDisputeStateDisplay(state);
  const badgeClass = getDisputeStateBadgeClass(state);
  const shortId = dispute._id?.toString?.().slice(-8) || "?";

  const deadlineStatus = getDeadlineStatus(dispute.deadline);
  const deadlineClass = deadlineStatus.color;

  let actionsHtml = "";
  const currentWallet = window.DepayWallet?.getSavedWallet() || "";

  // Buyer actions
  if (
    state === 2 &&
    currentWallet.toLowerCase() === (dispute.buyer || "").toLowerCase()
  ) {
    actionsHtml = `
      <button type="button" class="button" data-counter-btn="${dispute.escrowId}" title="Submit counter-response">
        Submit Counter Response
      </button>`;
  }

  // Seller actions
  if (
    state === 1 &&
    currentWallet.toLowerCase() === (dispute.seller || "").toLowerCase()
  ) {
    actionsHtml = `
      <button type="button" class="button" data-respond-btn="${dispute.escrowId}" title="Respond to dispute">
        Respond to Dispute
      </button>`;
  }

  // Enforce deadline (anyone)
  if (
    (state === 1 || state === 2) &&
    dispute.deadline &&
    dispute.deadline > 0
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (now > dispute.deadline) {
      actionsHtml += `
        <button type="button" class="button btn-enforce" data-enforce-btn="${dispute.escrowId}" title="Enforce expired deadline">
          ⚖️ Enforce Deadline
        </button>`;
    }
  }

  if (!actionsHtml) {
    actionsHtml = `<p class="muted" style="margin: 0;">Awaiting next action or admin resolution.</p>`;
  }

  return `
    <article class="dispute-card">
      <div class="dispute-header">
        <div>
          <h3>Dispute …${shortId}</h3>
          <p class="muted" style="margin: 0.2rem 0 0;">Order: ${
            dispute.orderId || "?"
          }</p>
        </div>
        <span class="status-badge ${badgeClass}">${stateDisplay}</span>
      </div>

      <div class="dispute-details">
        <div class="dispute-detail-row">
          <strong>Buyer:</strong>
          <code>${shortenAddress(dispute.buyer)}</code>
        </div>
        <div class="dispute-detail-row">
          <strong>Seller:</strong>
          <code>${shortenAddress(dispute.seller)}</code>
        </div>
        <div class="dispute-detail-row">
          <strong>Escrow ID:</strong>
          <code>${dispute.escrowId || "?"}</code>
        </div>
        ${
          dispute.deadline && dispute.deadline > 0
            ? `<div class="dispute-detail-row">
              <strong>Deadline:</strong>
              <span class="${deadlineClass}">${deadlineStatus.text}</span>
            </div>`
            : ""
        }
        ${
          dispute.txHash
            ? `<div class="dispute-detail-row">
              <strong>Opened TX:</strong>
              <code>${shortenHash(dispute.txHash)}</code>
            </div>`
            : ""
        }
      </div>

      <div class="dispute-actions">${actionsHtml}</div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Load disputes for connected buyer
// ---------------------------------------------------------------------------
async function loadBuyerDisputes() {
  const buyerWallet = window.DepayWallet?.getSavedWallet("buyer");

  if (!buyerWallet) {
    disputesListEl.innerHTML =
      '<p class="muted">Please connect your wallet to view disputes.</p>';
    disputesCountEl.textContent = "No wallet connected";
    setStatus("Connect wallet to view your disputes.", "error");
    return;
  }

  setStatus("Loading disputes…");
  disputesListEl.innerHTML = '<p class="muted">Loading…</p>';

  try {
    const response = await fetch(
      `${API_DISPUTES}/buyer/${encodeURIComponent(buyerWallet)}`,
    );
    const payload = response.json ? await response.json() : { disputes: [] };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch disputes");
    }

    const disputes = payload.disputes || [];

    if (disputes.length === 0) {
      disputesListEl.innerHTML =
        '<p class="muted">No disputes. All orders are proceeding normally.</p>';
      disputesCountEl.textContent = "0 disputes";
      setStatus("No active disputes.", "ok");
      return;
    }

    disputesCountEl.textContent = `${disputes.length} dispute${
      disputes.length !== 1 ? "s" : ""
    }`;

    const html = disputes.map(renderDispute).join("");
    disputesListEl.innerHTML = `<div class="disputes-list">${html}</div>`;

    // Attach event listeners
    disputesListEl.querySelectorAll("[data-respond-btn]").forEach((btn) => {
      btn.addEventListener("click", () =>
        sellerRespond(btn.dataset.respondBtn),
      );
    });

    disputesListEl.querySelectorAll("[data-counter-btn]").forEach((btn) => {
      btn.addEventListener("click", () => buyerCounter(btn.dataset.counterBtn));
    });

    disputesListEl.querySelectorAll("[data-enforce-btn]").forEach((btn) => {
      btn.addEventListener("click", () =>
        enforceDeadline(btn.dataset.enforceBtn),
      );
    });

    setStatus("Disputes loaded.", "ok");
  } catch (err) {
    setStatus(`Unable to load disputes: ${err.message}`, "error");
    disputesListEl.innerHTML =
      '<p class="muted">Try refreshing after backend is running.</p>';
  }
}

refreshDisputesBtn?.addEventListener("click", loadBuyerDisputes);
document.addEventListener("DOMContentLoaded", loadBuyerDisputes);
