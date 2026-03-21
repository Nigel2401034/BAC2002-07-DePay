function initSellerNavbar(root = document) {
  const connectWalletBtn = root.getElementById("connectWalletBtn") || document.getElementById("connectWalletBtn");
  const walletStatus = root.getElementById("walletStatus") || document.getElementById("walletStatus");
  const walletMenuLabel = root.getElementById("walletMenuLabel") || document.getElementById("walletMenuLabel");

  const walletApi = window.DepayWallet;

  if (!connectWalletBtn || !walletStatus || !walletMenuLabel) {
    return;
  }

  function renderWallet(wallet) {
    const connected = Boolean(wallet);

    walletMenuLabel.textContent = `MetaMask: ${connected ? "Connected" : "Disconnected"}`;

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

  async function syncWalletFromProvider() {
    if (!window.ethereum) {
      return;
    }

    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      const providerWallet = accounts && accounts[0] ? accounts[0] : "";

      if (walletApi) {
        if (providerWallet) {
          walletApi.saveWallet(providerWallet);
        } else {
          walletApi.clearWallet();
        }
      }

      renderWallet(providerWallet);
    } catch {
      const savedWallet = walletApi ? walletApi.getSavedWallet() : "";
      renderWallet(savedWallet);
    }
  }

  async function connectWallet() {
    if (!walletApi) {
      walletStatus.textContent = "Wallet utilities not loaded.";
      walletStatus.hidden = false;
      return;
    }

    try {
      const wallet = await walletApi.requestWalletConnection();
      renderWallet(wallet);
    } catch (error) {
      walletStatus.textContent = `Connection failed: ${error.message}`;
      walletStatus.hidden = false;
    }
  }

  connectWalletBtn.addEventListener("click", connectWallet);

  const savedWallet = walletApi ? walletApi.getSavedWallet() : "";
  renderWallet(savedWallet);
  syncWalletFromProvider();

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", (accounts) => {
      const wallet = accounts && accounts[0] ? accounts[0] : "";
      if (walletApi) {
        if (wallet) {
          walletApi.saveWallet(wallet);
        } else {
          walletApi.clearWallet();
        }
      }
      renderWallet(wallet);
    });
  }
}

window.initSellerNavbar = initSellerNavbar;
