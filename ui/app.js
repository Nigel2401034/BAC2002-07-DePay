(function initWalletUtils() {
	const STORAGE_KEY = "sellerWallet";

	function getSavedWallet() {
		return localStorage.getItem(STORAGE_KEY) || "";
	}

	function saveWallet(wallet) {
		if (!wallet) return;
		localStorage.setItem(STORAGE_KEY, wallet);
	}

	function clearWallet() {
		localStorage.removeItem(STORAGE_KEY);
	}

	function shortenWallet(wallet) {
		if (!wallet) return "";
		return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
	}

	async function requestWalletConnection() {
		if (!window.ethereum) {
			throw new Error("MetaMask not found. Install MetaMask extension first.");
		}

		const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
		const wallet = accounts && accounts[0] ? accounts[0] : "";
		if (!wallet) {
			throw new Error("No wallet account returned by MetaMask.");
		}

		if (window.APP_CONFIG && window.APP_CONFIG.expectedChainIdHex) {
			const currentChainId = await window.ethereum.request({ method: "eth_chainId" });
			if (currentChainId.toLowerCase() !== window.APP_CONFIG.expectedChainIdHex.toLowerCase()) {
				throw new Error(`Wrong network (${currentChainId}).`);
			}
		}

		saveWallet(wallet);
		return wallet;
	}

	window.DepayWallet = {
		getSavedWallet,
		saveWallet,
		clearWallet,
		shortenWallet,
		requestWalletConnection
	};
})();
