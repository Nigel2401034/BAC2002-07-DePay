const checkoutStatusEl = document.getElementById("checkoutStatus");
const checkoutItemsEl = document.getElementById("checkoutItems");
const checkoutTotalEl = document.getElementById("checkoutTotal");
const paymentResultEl = document.getElementById("paymentResult");
const payNowBtn = document.getElementById("payNowBtn");
const billingForm = document.getElementById("billingForm");
const shippingForm = document.getElementById("shippingForm");

const CART_STORAGE_KEY = "buyerCartItems";
const CHECKOUT_SELECTION_KEY = "buyerCheckoutSelection";
const TX_HISTORY_KEY = "buyerTransactionHistory";
const MIN_QTY = 1;
const MAX_QTY = 99;

let selectedItems = [];

function setStatus(message, type = "") {
  if (!checkoutStatusEl) return;
  checkoutStatusEl.textContent = message;
  checkoutStatusEl.className = `status ${type}`.trim();
}

function getCartItems() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getSelection() {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_SELECTION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return MIN_QTY;
  if (parsed < MIN_QTY) return MIN_QTY;
  if (parsed > MAX_QTY) return MAX_QTY;
  return parsed;
}

function toNativeHex(amountHlusd) {
  const value = Number(amountHlusd || 0);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid payment amount.");
  }

  // 1 HLUSD = 1e18 units (like ETH)
  const units = BigInt(Math.round(value * 1e18));

  return `0x${units.toString(16)}`;
}

function getTotalXsgd(items) {
  return items.reduce((sum, item) => {
    const qty = normalizeQuantity(item.quantity || 1);
    return sum + Number(item.priceXsgd || 0) * qty;
  }, 0);
}

function renderSelectedItems() {
  const cartItems = getCartItems();
  const selectedMeta = getSelection();
  const selectedMap = new Map();

  selectedMeta.forEach((entry) => {
    if (typeof entry === "string") {
      selectedMap.set(entry, 1);
      return;
    }
    if (!entry || !entry.id) return;
    selectedMap.set(entry.id, normalizeQuantity(entry.quantity || 1));
  });

  selectedItems = cartItems
    .filter((item) => selectedMap.has(item.id))
    .map((item) => ({
      ...item,
      quantity:
        selectedMap.get(item.id) || normalizeQuantity(item.quantity || 1),
    }));

  if (!selectedItems.length) {
    checkoutItemsEl.innerHTML =
      '<p class="muted">No selected cart items. Go back to cart and select items first.</p>';
    checkoutTotalEl.textContent = "Total: 0.00 XSGD";
    payNowBtn.disabled = true;
    setStatus("No selected items.", "error");
    return;
  }

  const rows = selectedItems
    .map((item) => {
      return `
        <article class="checkout-item-row">
          <h3>${item.title || "Untitled"}</h3>
          <p class="muted">Quantity: ${normalizeQuantity(
            item.quantity || 1,
          )}</p>
          <p class="muted">Seller: ${item.sellerWallet || "-"}</p>
          <p class="cart-meta">${Number(item.priceXsgd || 0).toFixed(
            2,
          )} XSGD each</p>
          <p class="cart-meta">Subtotal: ${(
            Number(item.priceXsgd || 0) * normalizeQuantity(item.quantity || 1)
          ).toFixed(2)} XSGD</p>
        </article>
      `;
    })
    .join("");

  checkoutItemsEl.innerHTML = `<div class="checkout-items-list">${rows}</div>`;

  const total = getTotalXsgd(selectedItems);
  checkoutTotalEl.textContent = `Total: ${total.toFixed(2)} XSGD`;
  payNowBtn.disabled = false;
  setStatus("Ready for billing, shipping, and wallet payment.", "ok");
}

function validateForms() {
  const billingOk = billingForm?.reportValidity();
  const shippingOk = shippingForm?.reportValidity();
  return Boolean(billingOk && shippingOk);
}

function getBillingShippingPayload() {
  const billingData = Object.fromEntries(new FormData(billingForm).entries());
  const shippingData = Object.fromEntries(new FormData(shippingForm).entries());
  return {
    billing: billingData,
    shipping: shippingData,
  };
}

function saveTransactionHistory(records) {
  const current = (() => {
    try {
      const raw = localStorage.getItem(TX_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const next = [...records, ...current];
  localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(next));
}

async function connectWalletIfNeeded() {
  if (!window.DepayWallet) {
    throw new Error("Wallet utilities are not loaded.");
  }

  const saved = window.DepayWallet.getSavedWallet("buyer");
  if (saved) {
    return saved;
  }

  return window.DepayWallet.requestWalletConnection("buyer");
}

async function switchToHelaNetwork() {
  if (!window.ethereum) {
    throw new Error("MetaMask not available.");
  }

  const expectedChainId = window.APP_CONFIG?.expectedChainIdHex || "0xa2d08";

  try {
    // Check current chain
    const currentChainId = await window.ethereum.request({
      method: "eth_chainId",
    });

    if (currentChainId.toLowerCase() === expectedChainId.toLowerCase()) {
      console.log("✅ Already on Hela network");
      return;
    }

    // Try to switch to Hela network
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expectedChainId }],
    });
    console.log("✅ Switched to Hela network");
  } catch (switchError) {
    console.error("Network switch error:", switchError);
    throw new Error(
      `Could not switch to Hela network. Make sure it's configured in MetaMask. Error: ${switchError.message}`,
    );
  }
}
function stringToHex(str) {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    result += str.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return result;
}

function generateCreateEscrowData(seller, orderRefHex) {
  // function signature: createEscrow(address,bytes32)
  const methodId = "0x748f4e3a";

  const paddedSeller = seller.toLowerCase().replace("0x", "").padStart(64, "0");
  const paddedOrderRef = orderRefHex.replace("0x", "").padEnd(64, "0");

  return methodId + paddedSeller + paddedOrderRef;
}

async function waitForTxReceipt(txHash, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    const receipt = await window.ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });

    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

async function sendTransactionWithRetry(params, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [params],
      });
      return txHash;
    } catch (error) {
      lastError = error;
      // Check if it's a rate limit or temporary error
      const isRateLimitError =
        error.code === -32002 ||
        error.message?.includes("too many errors") ||
        error.message?.includes("rate limit");

      if (isRateLimitError && attempt < maxRetries) {
        const waitMs = Math.pow(2, attempt) * 1000; // exponential backoff: 2s, 4s, 8s
        console.warn(
          `⚠️ RPC rate limit detected. Retrying in ${
            waitMs / 1000
          }s (attempt ${attempt}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

function extractEscrowIdFromReceipt(receipt, escrowAddress) {
  if (!receipt || !Array.isArray(receipt.logs)) return null;

  const escrowCreatedTopic =
    "0xd32a8e6ee4eaa7ae887d4659a3212bb80cc3691c898c8eae123745080a3dfcd1";

  for (const log of receipt.logs) {
    if (log.address?.toLowerCase() !== escrowAddress.toLowerCase()) continue;
    if (!Array.isArray(log.topics) || log.topics.length < 2) continue;
    if ((log.topics[0] || "").toLowerCase() !== escrowCreatedTopic) continue;
    return BigInt(log.topics[1]).toString();
  }

  return null;
}

async function paySelectedItems() {
  if (!selectedItems.length) {
    setStatus("No selected items to pay.", "error");
    return;
  }

  if (!validateForms()) {
    setStatus("Please complete billing and shipping details.", "error");
    return;
  }

  if (!window.ethereum) {
    setStatus("MetaMask is required for payment.", "error");
    return;
  }

  payNowBtn.disabled = true;
  paymentResultEl.innerHTML = '<p class="muted">Connecting wallet...</p>';

  try {
    const fromWallet = await connectWalletIfNeeded();

    // Switch to Hela network before payment
    setStatus("Switching to Hela network...");
    await switchToHelaNetwork();

    const customerDetails = getBillingShippingPayload();
    const txRecords = [];

    for (const item of selectedItems) {
      if (!item.sellerWallet) {
        throw new Error(
          `Listing \"${item.title || item.id}\" has no seller wallet.`,
        );
      }

      const quantity = normalizeQuantity(item.quantity || 1);
      const subtotalXsgd = Number(item.priceXsgd || 0) * quantity;

      const escrowAddress = window.APP_CONFIG?.escrowAddress;

      if (!escrowAddress) {
        throw new Error(
          "Escrow contract not configured. Check APP_CONFIG.escrowAddress",
        );
      }

      setStatus(`Processing payment for ${item.title}...`);

      // generate simple orderRef
      const orderRef = `ORDER_${Date.now()}_${item.id}`;
      const orderRefHex = "0x" + stringToHex(orderRef).slice(0, 64);

      console.log("🔐 Escrow Payment Details:", {
        from: fromWallet,
        to: escrowAddress,
        amount: subtotalXsgd,
        item: item.title,
        seller: item.sellerWallet,
        orderRef: orderRef,
      });

      // call createEscrow with retry logic
      const txHash = await sendTransactionWithRetry({
        from: fromWallet,
        to: escrowAddress,
        value: toNativeHex(subtotalXsgd),
        data: generateCreateEscrowData(item.sellerWallet, orderRefHex),
      });

      console.log("✅ Transaction sent:", txHash);

      const receipt = await waitForTxReceipt(txHash);
      const escrowId = extractEscrowIdFromReceipt(receipt, escrowAddress);
      if (!escrowId) {
        console.warn("⚠️ Escrow ID not found in receipt for tx:", txHash);
      }

      txRecords.push({
        txHash,
        escrowId,
        itemId: item.id,
        title: item.title || "Untitled",
        quantity,
        amountXsgd: subtotalXsgd,
        fromWallet,
        toWallet: item.sellerWallet,
        timestamp: new Date().toISOString(),
        billing: customerDetails.billing,
        shipping: customerDetails.shipping,
      });

      // Save to backend
      try {
        const backendRes = await fetch("http://localhost:5000/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyerWallet: fromWallet,
            items: [
              {
                id: item.id,
                title: item.title,
                quantity,
                amountXsgd: subtotalXsgd,
                sellerWallet: item.sellerWallet,
              },
            ],
            txHash,
            escrowId,
            amountHlusd: subtotalXsgd,
            billingAddress: customerDetails.billing.billingAddress,
            shippingAddress: customerDetails.shipping.shippingAddress,
          }),
        });

        if (!backendRes.ok) {
          console.warn(
            "⚠️ Backend order save failed:",
            await backendRes.text(),
          );
        } else {
          const backendData = await backendRes.json();
          console.log("📦 Order saved to backend:", backendData);
        }
      } catch (backendErr) {
        console.warn("⚠️ Backend error (non-critical):", backendErr.message);
      }
    }

    saveTransactionHistory(txRecords);

    const selectedIds = new Set(selectedItems.map((item) => item.id));
    const remainingCart = getCartItems().filter(
      (item) => !selectedIds.has(item.id),
    );
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(remainingCart));
    document.dispatchEvent(new CustomEvent("buyer-cart-updated"));

    paymentResultEl.innerHTML = txRecords
      .map(
        (record) =>
          `<p><strong>${record.title}</strong> x ${record.quantity}: <code>${record.txHash}</code></p>`,
      )
      .join("");

    setStatus(
      "✅ Payment successful! Funds locked in escrow. Go to Track Order to release after receiving items.",
      "ok",
    );
    payNowBtn.disabled = true;
  } catch (error) {
    console.error("❌ Payment error:", error);
    setStatus(`Payment failed: ${error.message}`, "error");
    paymentResultEl.innerHTML =
      '<p class="muted">No transactions completed. Check browser console for details.</p>';
    payNowBtn.disabled = false;
  }
}

payNowBtn?.addEventListener("click", paySelectedItems);
document.addEventListener("DOMContentLoaded", renderSelectedItems);
