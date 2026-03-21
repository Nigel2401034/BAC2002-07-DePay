const ordersListEl = document.getElementById("ordersList");
const ordersStatusEl = document.getElementById("ordersStatus");
const ordersCountEl = document.getElementById("ordersCount");
const refreshOrdersBtn = document.getElementById("refreshOrdersBtn");

const API_BASE_URL = "http://localhost:5000/api/orders";

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

function shortenTxHash(hash) {
  if (!hash) return "-";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function shortenCid(cid) {
  if (!cid) return "-";
  if (cid.length <= 18) return cid;
  return `${cid.slice(0, 10)}...${cid.slice(-6)}`;
}

function getStatusBadgeClass(status) {
  switch (status?.toLowerCase()) {
    case "funded":
      return "badge-funded";
    case "released":
      return "badge-released";
    case "refunded":
      return "badge-refunded";
    default:
      return "badge-unknown";
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
    const buyerWallet = window.DepayWallet.getSavedWallet();
    if (!buyerWallet) {
      throw new Error("Please connect your wallet first.");
    }

    const escrowAddress = window.APP_CONFIG?.escrowAddress;
    if (!escrowAddress) {
      throw new Error("Escrow contract not configured.");
    }

    setStatus("Fetching order details...");

    const orderRes = await fetch(`${API_BASE_URL}/detail/${orderId}`);
    if (!orderRes.ok) {
      throw new Error("Order not found.");
    }

    const orderData = await orderRes.json();
    if (!orderData.success || !orderData.order) {
      throw new Error("Invalid order data.");
    }

    const order = orderData.order;
    let escrowId = order.escrowId;

    if (!escrowId) {
      setStatus("Waiting for transaction receipt to extract Escrow ID...");
      // Wait for tx and get escrowId from event logs
      escrowId = await getEscrowIdFromTxReceipt(txHash);

      if (!escrowId) {
        throw new Error(
          "Could not find Escrow ID. Transaction may not be mined yet. Wait a few moments and try again.",
        );
      }

      // Update order with escrowId in backend
      try {
        await fetch(`${API_BASE_URL}/${orderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ escrowId }),
        });
      } catch (err) {
        console.warn("⚠️ Could not update backend escrowId:", err.message);
      }
    }

    setStatus("Confirming item received on blockchain...");

    // Call confirmReceived(uint256 escrowId)
    const methodId = "0x27dac36d";
    const paddedEscrowId = BigInt(escrowId).toString(16).padStart(64, "0");
    const data = methodId + paddedEscrowId;

    console.log("🔓 Releasing escrow:", {
      escrowId,
      methodId,
      escrowAddress,
      buyerWallet,
    });

    const releaseTxHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: buyerWallet,
          to: escrowAddress,
          data: data,
        },
      ],
    });

    console.log("✅ Release transaction sent:", releaseTxHash);

    // Update order status in backend
    try {
      await fetch(`${API_BASE_URL}/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "released",
          releaseTxHash: releaseTxHash,
        }),
      });
    } catch (backendErr) {
      console.warn("⚠️ Backend update failed:", backendErr.message);
    }

    setStatus("✅ Item marked as received! Funds released to seller.", "ok");
    setTimeout(() => loadBuyerOrders(), 2000);
  } catch (error) {
    console.error("❌ confirmReceivedItem error:", error);
    setStatus(`Failed to mark item received: ${error.message}`, "error");
  }
}

async function getEscrowIdFromTxReceipt(txHash) {
  if (!window.ethereum) return null;

  try {
    const escrowAddress = window.APP_CONFIG?.escrowAddress?.toLowerCase();
    if (!escrowAddress) return null;

    // Poll for receipt (tx might not be mined yet)
    let receipt = null;
    for (let i = 0; i < 30; i++) {
      receipt = await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      });

      if (receipt) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!receipt || !receipt.logs || receipt.logs.length === 0) {
      console.warn("No receipt/logs found for txHash:", txHash);
      return null;
    }

    const escrowCreatedTopic =
      "0xd32a8e6ee4eaa7ae887d4659a3212bb80cc3691c898c8eae123745080a3dfcd1";

    // Look for EscrowCreated logs emitted by our escrow contract
    for (const log of receipt.logs) {
      if (
        log.address?.toLowerCase() === escrowAddress &&
        log.topics?.length >= 2 &&
        (log.topics[0] || "").toLowerCase() === escrowCreatedTopic
      ) {
        const escrowId = BigInt(log.topics[1]).toString();
        console.log("📦 Found Escrow ID from event log:", escrowId);
        return escrowId;
      }
    }

    console.warn("Could not find EscrowCreated event in logs");
    return null;
  } catch (error) {
    console.error("Error getting tx receipt:", error);
    return null;
  }
}

async function loadBuyerOrders() {
  const buyerWallet = window.DepayWallet?.getSavedWallet();

  if (!buyerWallet) {
    ordersListEl.innerHTML =
      '<p class="muted">Please connect your wallet to view orders.</p>';
    ordersCountEl.textContent = "No wallet connected";
    setStatus("Connect wallet to view your orders.", "error");
    return;
  }

  setStatus("Loading orders...");
  ordersListEl.innerHTML = '<p class="muted">Loading...</p>';

  try {
    const response = await fetch(
      `${API_BASE_URL}/buyer/${encodeURIComponent(buyerWallet)}`,
    );
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Failed to fetch orders");
    }

    const orders = payload.orders || [];

    if (!Array.isArray(orders) || orders.length === 0) {
      ordersListEl.innerHTML = '<p class="muted">No orders found.</p>';
      ordersCountEl.textContent = "0 orders";
      setStatus("No active orders. Start by adding items to cart!", "ok");
      return;
    }

    ordersCountEl.textContent = `${orders.length} order${
      orders.length > 1 ? "s" : ""
    }`;

    const html = orders
      .map((order) => {
        const itemsHtml = (order.items || [])
          .map(
            (item) =>
              `<div class="order-item-mini">
              <strong>${item.title}</strong> x ${normalizeQuantity(
                item.quantity,
              )} = ${Number(item.amountXsgd || 0).toFixed(2)} HLUSD
            </div>`,
          )
          .join("");

        const statusClass = getStatusBadgeClass(order.status);
        const canRelease = order.status?.toLowerCase() === "funded";

        return `
          <article class="order-card">
            <div class="order-header">
              <h3>Order ${order._id?.toString?.().slice(-8) || "?"}</h3>
              <span class="status-badge ${statusClass}">${(
          order.status || "unknown"
        ).toUpperCase()}</span>
            </div>

            <div class="order-items">
              ${itemsHtml}
            </div>

            <div class="order-details">
              <p><strong>Total:</strong> ${Number(
                order.amountHlusd || 0,
              ).toFixed(2)} HLUSD</p>
              <p><strong>Date:</strong> ${formatDate(order.createdAt)}</p>
              <p><strong>Payment TX:</strong> <code>${shortenTxHash(
                order.txHash,
              )}</code></p>
              ${
                order.ipfsCid
                  ? `<p><strong>IPFS Record:</strong> <a href="${
                      order.ipfsGatewayUrl ||
                      `https://gateway.pinata.cloud/ipfs/${order.ipfsCid}`
                    }" target="_blank" rel="noopener noreferrer"><code>${shortenCid(
                      order.ipfsCid,
                    )}</code></a></p>`
                  : ""
              }
              ${
                order.releaseTxHash
                  ? `<p><strong>Release TX:</strong> <code>${shortenTxHash(
                      order.releaseTxHash,
                    )}</code></p>`
                  : ""
              }
              ${
                order.lastUpdateIpfsCid
                  ? `<p><strong>Last Update IPFS:</strong> <a href="${
                      order.lastUpdateIpfsGatewayUrl ||
                      `https://gateway.pinata.cloud/ipfs/${order.lastUpdateIpfsCid}`
                    }" target="_blank" rel="noopener noreferrer"><code>${shortenCid(
                      order.lastUpdateIpfsCid,
                    )}</code></a></p>`
                  : ""
              }
            </div>

            <div class="order-actions">
              ${
                canRelease
                  ? `<button type="button" class="button" data-confirm-btn="${
                      order._id
                    }" data-tx-hash="${
                      order.txHash || ""
                    }">Item Received - Release Funds</button>`
                  : `<p class="muted">Funds ${
                      order.status?.toLowerCase() === "released"
                        ? "released to seller"
                        : "pending"
                    }.</p>`
              }
            </div>
          </article>
        `;
      })
      .join("");

    ordersListEl.innerHTML = `<div class="orders-list">${html}</div>`;

    // Attach event listeners to confirm buttons
    const confirmBtns = ordersListEl.querySelectorAll("[data-confirm-btn]");
    confirmBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const orderId = btn.dataset.confirmBtn || "";
        const txHash = btn.dataset.txHash || "";
        confirmReceivedItem(orderId, txHash);
      });
    });

    setStatus("Orders loaded.", "ok");
  } catch (error) {
    setStatus(`Unable to load orders: ${error.message}`, "error");
    ordersListEl.innerHTML =
      '<p class="muted">Try refreshing after backend is running.</p>';
  }
}

refreshOrdersBtn?.addEventListener("click", loadBuyerOrders);
document.addEventListener("DOMContentLoaded", loadBuyerOrders);
