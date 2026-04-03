const disputesListEl = document.getElementById("disputesList");
const disputesStatusEl = document.getElementById("disputesStatus");
const disputesCountEl = document.getElementById("disputesCount");
const refreshDisputesBtn = document.getElementById("refreshDisputesBtn");

const API_DISPUTES = "http://localhost:5000/api/disputes";

// Dispute state constants (from contract)
const DISPUTE_STATES = {
  0: { label: "None", badge: "badge-unknown", display: "No Dispute" },
  1: { label: "Awaiting Seller", badge: "badge-warn", display: "Awaiting Your Response" },
  2: { label: "Awaiting Buyer", badge: "badge-warn", display: "Awaiting Buyer Counter" },
  3: { label: "Awaiting Admin", badge: "badge-critical", display: "Pending Admin Decision" },
  4: { label: "Resolved", badge: "badge-resolved", display: "Resolved" },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function setStatus(message, type = "") {
  if (!disputesStatusEl) return;
  disputesStatusEl.textContent = message;
  disputesStatusEl.className = `status ${type}`.trim();
}

function shortenHash(hash) {
  if (!hash) return "-";
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function shortenAddress(addr) {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getDisputeStateDisplay(state) {
  const info = DISPUTE_STATES[state] || DISPUTE_STATES[0];
  return info.display;
}

function getDisputeStateBadgeClass(state) {
  const info = DISPUTE_STATES[state] || DISPUTE_STATES[0];
  return info.badge;
}

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
// Seller respond to dispute
// ---------------------------------------------------------------------------
async function sellerRespond(escrowId) {
  if (!window.ethereum) {
    setStatus("MetaMask is required.", "error");
    return;
  }

  try {
    const sellerWallet = window.DepayWallet.getSavedWallet();
    if (!sellerWallet) throw new Error("Please connect your wallet first.");

    const disputeAddress = window.APP_CONFIG?.disputeAddress;
    if (!disputeAddress) throw new Error("Dispute contract not configured.");

    setStatus("Responding to dispute on blockchain…");

    const methodId = "0xb9d0f6ca"; // sellerRespond(uint256)
    const paddedId = BigInt(escrowId).toString(16).padStart(64, "0");

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: sellerWallet, to: disputeAddress, data: methodId + paddedId }],
    });

    setStatus(`✅ Response submitted! TX: ${shortenHash(txHash)}`, "ok");
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    console.error("sellerRespond error:", err);
    setStatus(`Failed: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Render dispute card for seller view
// ---------------------------------------------------------------------------
function renderSellerDispute(dispute) {
  const state = dispute.state || 0;
  const stateDisplay = getDisputeStateDisplay(state);
  const badgeClass = getDisputeStateBadgeClass(state);
  const shortId = dispute._id?.toString?.().slice(-8) || "?";

  const deadlineStatus = getDeadlineStatus(dispute.deadline);
  const deadlineClass = deadlineStatus.color;

  let actionsHtml = "";
  const currentWallet = window.DepayWallet?.getSavedWallet() || "";

  // Seller can respond when awaiting seller
  if (state === 1 && currentWallet.toLowerCase() === (dispute.seller || "").toLowerCase()) {
    actionsHtml = `
      <button type="button" class="button" data-respond-btn="${dispute.escrowId}" title="Submit your response to this dispute">
        Submit Response
      </button>`;
  }

  if (!actionsHtml) {
    actionsHtml = `<p class="muted" style="margin: 0;">No action required at this time.</p>`;
  }

  return `
    <article class="dispute-card">
      <div class="dispute-header">
        <div>
          <h3>Dispute …${shortId}</h3>
          <p class="muted" style="margin: 0.2rem 0 0;">Order: ${dispute.orderId || "?"}</p>
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
        ${dispute.deadline && dispute.deadline > 0
          ? `<div class="dispute-detail-row">
              <strong>Deadline:</strong>
              <span class="${deadlineClass}">${deadlineStatus.text}</span>
            </div>`
          : ""}
        ${dispute.txHash
          ? `<div class="dispute-detail-row">
              <strong>Opened TX:</strong>
              <code>${shortenHash(dispute.txHash)}</code>
            </div>`
          : ""}
      </div>

      <div class="dispute-actions">${actionsHtml}</div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Load disputes for connected seller
// ---------------------------------------------------------------------------
async function loadSellerDisputes() {
  const sellerWallet = window.DepayWallet?.getSavedWallet();

  if (!sellerWallet) {
    disputesListEl.innerHTML = '<p class="muted">Please connect your wallet to view disputes.</p>';
    disputesCountEl.textContent = "No wallet connected";
    setStatus("Connect wallet to view disputes against your sales.", "error");
    return;
  }

  setStatus("Loading disputes…");
  disputesListEl.innerHTML = '<p class="muted">Loading…</p>';

  try {
    const response = await fetch(
      `${API_DISPUTES}/seller/${encodeURIComponent(sellerWallet)}`
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch disputes");
    }

    const disputes = payload.disputes || [];

    if (disputes.length === 0) {
      disputesListEl.innerHTML = '<p class="muted">No disputes. All sales are proceeding smoothly.</p>';
      disputesCountEl.textContent = "0 disputes";
      setStatus("No active disputes.", "ok");
      return;
    }

    disputesCountEl.textContent = `${disputes.length} dispute${disputes.length !== 1 ? "s" : ""}`;

    const html = disputes.map(renderSellerDispute).join("");
    disputesListEl.innerHTML = `<div class="disputes-list">${html}</div>`;

    // Attach event listeners
    disputesListEl.querySelectorAll("[data-respond-btn]").forEach((btn) => {
      btn.addEventListener("click", () =>
        sellerRespond(btn.dataset.respondBtn)
      );
    });

    setStatus("Disputes loaded.", "ok");
  } catch (err) {
    setStatus(`Unable to load disputes: ${err.message}`, "error");
    disputesListEl.innerHTML =
      '<p class="muted">Try refreshing after backend is running.</p>';
  }
}

refreshDisputesBtn?.addEventListener("click", loadSellerDisputes);
document.addEventListener("DOMContentLoaded", loadSellerDisputes);
