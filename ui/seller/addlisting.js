const listingForm = document.getElementById("newListingForm");
const createListingBtn = document.getElementById("createListingBtn");
const verifyConnectBtn = document.getElementById("verifyConnectBtn");
const walletVerifyStatus = document.getElementById("walletVerifyStatus");
const statusEl = document.getElementById("addListingStatus");
const resultBox = document.getElementById("addListingResult");
const mongoIdEl = document.getElementById("listingMongoId");
const detailsLinkEl = document.getElementById("listingDetailsLink");
const cidLinkEl = document.getElementById("listingCidLink");

const API_BASE_URL = "http://localhost:5000/api/listings";

function setStatus(message, type = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function getSellerWallet() {
  return window.DepayWallet ? window.DepayWallet.getSavedWallet("seller") : "";
}

function setWalletVerifyStatus(message, type = "") {
  if (!walletVerifyStatus) return;
  walletVerifyStatus.textContent = message;
  walletVerifyStatus.className = `status ${type}`.trim();
}

function refreshWalletVerification() {
  const sellerWallet = getSellerWallet();
  const connected = Boolean(sellerWallet);

  if (connected) {
    setWalletVerifyStatus(`Connected: ${sellerWallet}`, "ok");
    createListingBtn.disabled = false;
    if (verifyConnectBtn) verifyConnectBtn.textContent = "Reconnect MetaMask";
    return;
  }

  setWalletVerifyStatus("Wallet not connected.", "error");
  createListingBtn.disabled = true;
  if (verifyConnectBtn) verifyConnectBtn.textContent = "Connect MetaMask";
}

async function connectWalletForVerification() {
  if (!window.DepayWallet) {
    setWalletVerifyStatus("Wallet utilities not loaded.", "error");
    return;
  }

  try {
    await window.DepayWallet.requestWalletConnection("seller");
    refreshWalletVerification();
  } catch (error) {
    setWalletVerifyStatus(`Connection failed: ${error.message}`, "error");
  }
}

listingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const sellerWallet = getSellerWallet();
  if (!sellerWallet) {
    setWalletVerifyStatus(
      "Connect MetaMask before submitting listing.",
      "error",
    );
    setStatus("Connect MetaMask first to add listing.", "error");
    return;
  }

  const formData = new FormData(listingForm);
  formData.append("sellerWallet", sellerWallet);

  createListingBtn.disabled = true;
  setStatus("Creating listing...", "");

  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Failed to create listing");
    }

    setStatus("Listing created successfully.", "ok");
    mongoIdEl.textContent = payload.listingId;
    const detailsUrl = `./sellerlistingdetails.html?id=${encodeURIComponent(
      payload.listingId,
    )}`;
    detailsLinkEl.textContent = detailsUrl;
    detailsLinkEl.href = detailsUrl;
    cidLinkEl.textContent = payload.ipfsCid;
    cidLinkEl.href = `${window.APP_CONFIG.ipfsGatewayBase}${payload.ipfsCid}`;
    resultBox.hidden = false;
    listingForm.reset();
  } catch (error) {
    setStatus(`Create listing failed: ${error.message}`, "error");
  } finally {
    createListingBtn.disabled = false;
  }
});

verifyConnectBtn?.addEventListener("click", connectWalletForVerification);

if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => {
    refreshWalletVerification();
  });
}

document.addEventListener("DOMContentLoaded", refreshWalletVerification);
