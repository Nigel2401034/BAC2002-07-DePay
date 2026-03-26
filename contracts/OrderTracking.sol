// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * @title OrderTracking
 * @notice Stores on-chain shipment state for DePay escrow orders.
 *         The oracle wallet calls createTracking() when an order is funded,
 *         then updateStatus() as delivery progresses.
 *
 * Status values:
 *   0 — PENDING   (tracking registered, not yet shipped)
 *   1 — SHIPPED   (courier has picked up the package)
 *   2 — DELIVERED (package delivered; oracle will release escrow)
 */
contract OrderTracking {
    uint8 public constant STATUS_PENDING   = 0;
    uint8 public constant STATUS_SHIPPED   = 1;
    uint8 public constant STATUS_DELIVERED = 2;

    struct Tracking {
        bytes32 orderRef;   // keccak256 of MongoDB orderId, set by oracle
        uint8   status;
        uint256 updatedAt;  // block.timestamp of last status change
        bool    exists;
    }

    address public immutable owner;
    address public oracle;

    // escrowId => Tracking
    mapping(uint256 => Tracking) private trackings;

    event TrackingCreated(
        uint256 indexed escrowId,
        bytes32         orderRef,
        uint256         timestamp
    );

    event StatusUpdated(
        uint256 indexed escrowId,
        uint8           newStatus,
        uint256         timestamp
    );

    event OracleSet(address indexed newOracle);

    error ZeroAddress();
    error NotOwner();
    error NotOracle();
    error AlreadyExists();
    error NotFound();
    error InvalidStatusTransition();

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
    }

    // -----------------------------------------------------------------------
    // Owner
    // -----------------------------------------------------------------------

    function setOracle(address _oracle) external {
        if (msg.sender != owner) revert NotOwner();
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
        emit OracleSet(_oracle);
    }

    // -----------------------------------------------------------------------
    // Oracle
    // -----------------------------------------------------------------------

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    /**
     * @notice Register a new tracking record for a funded escrow.
     * @param escrowId  The escrow ID from DePayEscrow.
     * @param orderRef  keccak256 hash of the off-chain MongoDB order ID.
     */
    function createTracking(uint256 escrowId, bytes32 orderRef) external onlyOracle {
        if (trackings[escrowId].exists) revert AlreadyExists();
        trackings[escrowId] = Tracking({
            orderRef:  orderRef,
            status:    STATUS_PENDING,
            updatedAt: block.timestamp,
            exists:    true
        });
        emit TrackingCreated(escrowId, orderRef, block.timestamp);
    }

    /**
     * @notice Advance the shipment status. Must move forward (no rollback).
     * @param escrowId  The escrow ID.
     * @param newStatus The new status value (1 = SHIPPED, 2 = DELIVERED).
     */
    function updateStatus(uint256 escrowId, uint8 newStatus) external onlyOracle {
        Tracking storage t = trackings[escrowId];
        if (!t.exists) revert NotFound();
        // Enforce forward-only progression and valid range
        if (newStatus <= t.status || newStatus > STATUS_DELIVERED) {
            revert InvalidStatusTransition();
        }
        t.status    = newStatus;
        t.updatedAt = block.timestamp;
        emit StatusUpdated(escrowId, newStatus, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // View
    // -----------------------------------------------------------------------

    function getTracking(uint256 escrowId)
        external
        view
        returns (
            bytes32 orderRef,
            uint8   status,
            uint256 updatedAt,
            bool    exists
        )
    {
        Tracking storage t = trackings[escrowId];
        return (t.orderRef, t.status, t.updatedAt, t.exists);
    }
}
