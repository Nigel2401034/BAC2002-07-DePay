function initBuyerNavbar(root = document) {
  const connectWalletBtn =
    root.getElementById("connectWalletBtn") ||
    document.getElementById("connectWalletBtn");
  const walletStatus =
    root.getElementById("walletStatus") ||
    document.getElementById("walletStatus");
  const walletMenuLabel =
    root.getElementById("walletMenuLabel") ||
    document.getElementById("walletMenuLabel");
  const cartNavLink =
    root.getElementById("buyerCartNavLink") ||
    document.getElementById("buyerCartNavLink");

  const walletApi = window.DepayWallet;
  const walletRole = "buyer";
  const cartStorageKey = "buyerCartItems";

  if (!connectWalletBtn || !walletStatus || !walletMenuLabel) {
    return;
  }

  function renderCartCount() {
    if (!cartNavLink) return;
    try {
      const raw = localStorage.getItem(cartStorageKey);
      const items = raw ? JSON.parse(raw) : [];
      const totalItems = Array.isArray(items)
        ? items.reduce((sum, item) => sum + Number(item.quantity || 1), 0)
        : 0;
      cartNavLink.textContent =
        totalItems > 0 ? `Cart (${totalItems})` : "Cart";
    } catch {
      cartNavLink.textContent = "Cart";
    }
  }

  function renderWallet(wallet) {
    const connected = Boolean(wallet);

    walletMenuLabel.textContent = `MetaMask: ${
      connected ? "Connected" : "Disconnected"
    }`;

    if (!connected) {
      walletStatus.hidden = true;
      walletStatus.textContent = "";
      connectWalletBtn.hidden = false;
      connectWalletBtn.style.display = "inline-block";
      return;
    }

    walletStatus.hidden = false;
    walletStatus.textContent = `Wallet: ${wallet}`;
    connectWalletBtn.hidden = true;
    connectWalletBtn.style.display = "none";
  }

  async function connectWallet() {
    if (!walletApi) {
      walletStatus.textContent = "Wallet utilities not loaded.";
      walletStatus.hidden = false;
      return;
    }

    try {
      const wallet = await walletApi.requestWalletConnection(walletRole);
      renderWallet(wallet);
    } catch (error) {
      walletStatus.textContent = `Connection failed: ${error.message}`;
      walletStatus.hidden = false;
    }
  }

  connectWalletBtn.addEventListener("click", connectWallet);

  const savedWallet = walletApi ? walletApi.getSavedWallet(walletRole) : "";
  renderWallet(savedWallet);
  renderCartCount();

  window.addEventListener("storage", (event) => {
    if (event.key === cartStorageKey) {
      renderCartCount();
    }
  });

  document.addEventListener("buyer-cart-updated", renderCartCount);

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", (accounts) => {
      const wallet = accounts && accounts[0] ? accounts[0] : "";
      const hasConnectedBuyer = walletApi
        ? Boolean(walletApi.getSavedWallet(walletRole))
        : false;

      if (!hasConnectedBuyer) {
        renderWallet("");
        return;
      }

      if (walletApi) {
        if (wallet) {
          walletApi.saveWallet(wallet, walletRole);
        } else {
          walletApi.clearWallet(walletRole);
        }
      }
      renderWallet(wallet);
    });
  }
}

window.initBuyerNavbar = initBuyerNavbar;
