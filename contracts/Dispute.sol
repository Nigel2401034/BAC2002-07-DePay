// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IDePayEscrow {
    function getEscrow(uint256 escrowId)
        external
        view
        returns (address buyer, address seller, uint128 amount, uint8 status);

    function freeze(uint256 escrowId) external;
    function disputeRelease(uint256 escrowId) external;
    function disputeRefund(uint256 escrowId) external;
}

interface IOrderTracking {
    function getTracking(uint256 escrowId)
        external
        view
        returns (bytes32 orderRef, uint8 status, uint256 updatedAt, bool exists);
}

/**
 * @title DePayDispute
 * @notice Handles buyer-raised disputes against funded escrow orders.
 *
 * Full flow:
 *
 *   1. Buyer calls openDispute(escrowId).
 *      Funds are immediately refunded to buyer and the dispute is marked resolved.
 *
 *   2. [Legacy flow] Seller may call sellerRespond() within 3 days.
 *        - No response in time → anyone calls enforceDeadline() → buyer refunded.
 *
 *   3. [Legacy flow] If seller responds, buyer has 3 days to call buyerCounter().
 *        - No counter in time  → anyone calls enforceDeadline() → seller paid.
 *
 *   4. [Legacy flow] If buyer counters, dispute escalates to admin.
 *        - Owner calls adminResolve(escrowId, refundBuyer) to make the final call.
 *
 * Note: Because the same wallet may act as both buyer and seller in test/demo
 * environments, the admin (owner) is the ultimate safeguard against abuse.
 */
contract DePayDispute is ReentrancyGuard {

    // Mirrors OrderTracking.sol constants
    uint8 private constant TRACK_SHIPPED   = 1;
    uint8 private constant TRACK_DELIVERED = 2;

    // Mirrors Escrow.sol STATUS_FUNDED
    uint8 private constant ESC_FUNDED = 1;

    // Dispute state machine
    uint8 public constant STATE_NONE            = 0;  // no dispute open
    uint8 public constant STATE_AWAITING_SELLER = 1;  // waiting for seller to respond
    uint8 public constant STATE_AWAITING_BUYER  = 2;  // waiting for buyer to counter
    uint8 public constant STATE_AWAITING_ADMIN  = 3;  // both responded, admin decides
    uint8 public constant STATE_RESOLVED        = 4;  // dispute closed

    // Response windows — 3 days each (suitable for testnet demo; increase for production)
    uint256 public constant SELLER_WINDOW   = 3 days;
    uint256 public constant BUYER_WINDOW    = 3 days;

    // How long SHIPPED with no update before the package is considered stuck
    uint256 public constant STUCK_THRESHOLD = 3 days;

    struct Dispute {
        address buyer;
        address seller;
        uint8   state;
        uint256 deadline;   // deadline for current pending party; 0 when awaiting admin
    }

    address public immutable owner;
    IDePayEscrow   public immutable escrow;
    IOrderTracking public immutable tracking;

    mapping(uint256 => Dispute) private disputes;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    /// @param reason  0 = unclear (deadline system started)
    ///                1 = immediate: delivered, seller wins
    ///                2 = immediate: stuck, buyer wins
    event DisputeOpened(uint256 indexed escrowId, address indexed buyer, uint8 reason);
    event SellerResponded(uint256 indexed escrowId, uint256 buyerDeadline);
    event BuyerCountered(uint256 indexed escrowId);
    event DeadlineEnforced(uint256 indexed escrowId, address indexed enforcer, bool refundedBuyer);
    event AdminResolved(uint256 indexed escrowId, bool refundedBuyer);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
    error NotOwner();
    error NotBuyer();
    error NotSeller();
    error EscrowNotFunded();
    error DisputeAlreadyActive();
    error WrongState();
    error DeadlineNotPassed();
    error DeadlineExpired();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address _owner, address _escrow, address _tracking) {
        if (_owner == address(0) || _escrow == address(0) || _tracking == address(0))
            revert ZeroAddress();
        owner    = _owner;
        escrow   = IDePayEscrow(_escrow);
        tracking = IOrderTracking(_tracking);
    }

    // -----------------------------------------------------------------------
    // 1. Open dispute (buyer only)
    // -----------------------------------------------------------------------

    /**
     * @notice Buyer raises a dispute against a funded escrow.
     *         Current policy: opening a dispute immediately refunds the buyer.
     */
    function openDispute(uint256 escrowId) external nonReentrant {
        (address buyer, address seller, , uint8 escStatus) = escrow.getEscrow(escrowId);
        if (escStatus != ESC_FUNDED) revert EscrowNotFunded();
        if (msg.sender != buyer)     revert NotBuyer();

        Dispute storage d = disputes[escrowId];
        if (d.state != STATE_NONE) revert DisputeAlreadyActive();

        // Record parties before any branching so getDispute() always shows them
        d.buyer  = buyer;
        d.seller = seller;

        _resolveRefund(escrowId, d);
        emit DisputeOpened(escrowId, buyer, 2);
    }

    // -----------------------------------------------------------------------
    // 2. Seller responds (must be before seller deadline)
    // -----------------------------------------------------------------------

    /**
     * @notice Seller acknowledges the dispute within the response window.
     *         Starts the buyer counter window.
     */
    function sellerRespond(uint256 escrowId) external {
        Dispute storage d = disputes[escrowId];
        if (d.state != STATE_AWAITING_SELLER) revert WrongState();
        if (msg.sender != d.seller)           revert NotSeller();
        if (block.timestamp > d.deadline)     revert DeadlineExpired();

        d.state    = STATE_AWAITING_BUYER;
        d.deadline = block.timestamp + BUYER_WINDOW;

        emit SellerResponded(escrowId, d.deadline);
    }

    // -----------------------------------------------------------------------
    // 3. Buyer counters (must be before buyer deadline)
    // -----------------------------------------------------------------------

    /**
     * @notice Buyer counters the seller's response within the counter window.
     *         Escalates the dispute to admin arbitration.
     */
    function buyerCounter(uint256 escrowId) external {
        Dispute storage d = disputes[escrowId];
        if (d.state != STATE_AWAITING_BUYER) revert WrongState();
        if (msg.sender != d.buyer)           revert NotBuyer();
        if (block.timestamp > d.deadline)    revert DeadlineExpired();

        d.state    = STATE_AWAITING_ADMIN;
        d.deadline = 0;  // no deadline; admin decides at their discretion

        emit BuyerCountered(escrowId);
    }

    // -----------------------------------------------------------------------
    // 4. Enforce an expired deadline (anyone can call)
    // -----------------------------------------------------------------------

    /**
     * @notice Triggers automatic resolution once a response window has lapsed.
     *         Open to anyone so that neither party can hold the other hostage
     *         by simply doing nothing.
     *
     *         Seller missed window  → buyer refunded.
     *         Buyer missed window   → seller paid.
     */
    function enforceDeadline(uint256 escrowId) external nonReentrant {
        Dispute storage d = disputes[escrowId];

        if (d.state == STATE_AWAITING_SELLER) {
            if (block.timestamp <= d.deadline) revert DeadlineNotPassed();
            _resolveRefund(escrowId, d);
            emit DeadlineEnforced(escrowId, msg.sender, true);
            return;
        }

        if (d.state == STATE_AWAITING_BUYER) {
            if (block.timestamp <= d.deadline) revert DeadlineNotPassed();
            _resolveRelease(escrowId, d);
            emit DeadlineEnforced(escrowId, msg.sender, false);
            return;
        }

        revert WrongState();
    }

    // -----------------------------------------------------------------------
    // 5. Admin resolves fully contested disputes
    // -----------------------------------------------------------------------

    /**
     * @notice Owner makes the final call when both parties have responded.
     * @param refundBuyer  true  → refund buyer (buyer wins).
     *                     false → release to seller (seller wins).
     */
    function adminResolve(uint256 escrowId, bool refundBuyer) external nonReentrant {
        if (msg.sender != owner) revert NotOwner();

        Dispute storage d = disputes[escrowId];
        if (d.state != STATE_AWAITING_ADMIN) revert WrongState();

        if (refundBuyer) {
            _resolveRefund(escrowId, d);
        } else {
            _resolveRelease(escrowId, d);
        }

        emit AdminResolved(escrowId, refundBuyer);
    }

    // -----------------------------------------------------------------------
    // View
    // -----------------------------------------------------------------------

    function getDispute(uint256 escrowId)
        external
        view
        returns (
            address buyer,
            address seller,
            uint8   state,
            uint256 deadline
        )
    {
        Dispute storage d = disputes[escrowId];
        return (d.buyer, d.seller, d.state, d.deadline);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _resolveRelease(uint256 escrowId, Dispute storage d) internal {
        d.state    = STATE_RESOLVED;
        d.deadline = 0;
        escrow.disputeRelease(escrowId);
    }

    function _resolveRefund(uint256 escrowId, Dispute storage d) internal {
        d.state    = STATE_RESOLVED;
        d.deadline = 0;
        escrow.disputeRefund(escrowId);
    }
}
