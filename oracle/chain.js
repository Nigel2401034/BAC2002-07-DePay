/**
 * oracle/chain.js
 * Lazily initialises ethers provider, oracle wallet, and contract instances.
 * Shared by oracle.js (daemon) and oracle-routes.js (Express routes).
 *
 * Required env vars:
 *   ORACLE_PRIVATE_KEY        — private key of the wallet set as oracle
 *   ESCROW_ADDRESS            — deployed DePayEscrow address
 *   ORDER_TRACKING_ADDRESS    — deployed OrderTracking address (optional)
 */
const { ethers } = require("ethers");

const HELA_RPC = "https://testnet-rpc.helachain.com";

// Minimal human-readable ABIs — only the functions the oracle needs
const ESCROW_ABI = [
  "function oracleRelease(uint256 escrowId) external",
  "function getEscrow(uint256 escrowId) external view returns (address buyer, address seller, uint128 amount, uint8 status)",
];

const ORDER_TRACKING_ABI = [
  "function createTracking(uint256 escrowId, bytes32 orderRef) external",
  "function updateStatus(uint256 escrowId, uint8 newStatus) external",
  "function getTracking(uint256 escrowId) external view returns (bytes32 orderRef, uint8 status, uint256 updatedAt, bool exists)",
];

let _provider = null;
let _wallet = null;
let _escrow = null;
let _tracking = null; // may be null if ORDER_TRACKING_ADDRESS not set

function getContracts() {
  if (_provider) {
    return { provider: _provider, wallet: _wallet, escrow: _escrow, tracking: _tracking };
  }

  if (!process.env.ORACLE_PRIVATE_KEY) {
    throw new Error("ORACLE_PRIVATE_KEY is not set in .env");
  }
  if (!process.env.ESCROW_ADDRESS) {
    throw new Error("ESCROW_ADDRESS is not set in .env");
  }

  _provider = new ethers.JsonRpcProvider(HELA_RPC);
  _wallet   = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, _provider);
  _escrow   = new ethers.Contract(process.env.ESCROW_ADDRESS, ESCROW_ABI, _wallet);

  if (process.env.ORDER_TRACKING_ADDRESS) {
    _tracking = new ethers.Contract(
      process.env.ORDER_TRACKING_ADDRESS,
      ORDER_TRACKING_ABI,
      _wallet
    );
  } else {
    console.warn("⚠️  ORDER_TRACKING_ADDRESS not set — on-chain tracking disabled");
  }

  return { provider: _provider, wallet: _wallet, escrow: _escrow, tracking: _tracking };
}

// Reset cached instances (used in tests or if env changes)
function resetContracts() {
  _provider = null;
  _wallet   = null;
  _escrow   = null;
  _tracking = null;
}

module.exports = { getContracts, resetContracts };
