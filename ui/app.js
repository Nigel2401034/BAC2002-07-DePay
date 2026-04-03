(function initWalletUtils() {
  const STORAGE_KEYS = {
    buyer: "buyerWallet",
    seller: "sellerWallet",
  };

  function normalizeRole(role) {
    return role === "buyer" ? "buyer" : "seller";
  }

  function getStorageKey(role) {
    return STORAGE_KEYS[normalizeRole(role)];
  }

  function getSavedWallet(role = "seller") {
    return localStorage.getItem(getStorageKey(role)) || "";
  }

  function saveWallet(wallet, role = "seller") {
    if (!wallet) return;
    localStorage.setItem(getStorageKey(role), wallet);
  }

  function clearWallet(role = "seller") {
    localStorage.removeItem(getStorageKey(role));
  }

  function shortenWallet(wallet) {
    if (!wallet) return "";
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  }

  async function requestWalletConnection(role = "seller") {
    if (!window.ethereum) {
      throw new Error("MetaMask not found. Install MetaMask extension first.");
    }

    if (window.APP_CONFIG && window.APP_CONFIG.expectedChainIdHex) {
      const currentChainId = await window.ethereum.request({
        method: "eth_chainId",
      });
      if (
        currentChainId.toLowerCase() !==
        window.APP_CONFIG.expectedChainIdHex.toLowerCase()
      ) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: window.APP_CONFIG.expectedChainIdHex }],
          });
        } catch (switchError) {
          throw new Error(
            `Wrong network (${currentChainId}). Please switch MetaMask to ${window.APP_CONFIG.expectedChainIdHex} and try again.`,
          );
        }
      }
    }

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
    const wallet = accounts && accounts[0] ? accounts[0] : "";
    if (!wallet) {
      throw new Error("No wallet account returned by MetaMask.");
    }

    saveWallet(wallet, role);
    return wallet;
  }

  window.DepayWallet = {
    getSavedWallet,
    saveWallet,
    clearWallet,
    shortenWallet,
    requestWalletConnection,
  };
})();
