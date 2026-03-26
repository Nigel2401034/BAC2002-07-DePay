// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract DePayEscrow is ReentrancyGuard {
    uint8 private constant STATUS_FUNDED   = 1;
    uint8 private constant STATUS_RELEASED = 2;
    uint8 private constant STATUS_REFUNDED = 3;

    struct Escrow {
        address buyer;
        address seller;
        uint128 amount;
        uint8   status;
    }

    address public immutable owner;
    address public oracle;
    address public disputeContract;
    uint256 public nextEscrowId;

    mapping(uint256 => Escrow) private escrows;
    mapping(uint256 => bool)   public  frozen;   // set by dispute contract; blocks oracle release

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        bytes32 orderRef
    );
    event EscrowReleased(uint256 indexed escrowId);
    event EscrowRefunded(uint256 indexed escrowId);
    event EscrowFrozen(uint256 indexed escrowId);
    event OracleSet(address indexed newOracle);
    event DisputeContractSet(address indexed newDisputeContract);

    error ZeroAddress();
    error ZeroAmount();
    error NotOwner();
    error NotBuyer();
    error NotOracle();
    error NotDisputeContract();
    error InvalidStatus();
    error EscrowNotFound();
    error TransferFailed();
    error Frozen();

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    modifier onlyDisputeContract() {
        if (msg.sender != disputeContract) revert NotDisputeContract();
        _;
    }

    // -----------------------------------------------------------------------
    // Owner functions
    // -----------------------------------------------------------------------

    function setOracle(address _oracle) external {
        if (msg.sender != owner) revert NotOwner();
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
        emit OracleSet(_oracle);
    }

    function setDisputeContract(address _dispute) external {
        if (msg.sender != owner) revert NotOwner();
        if (_dispute == address(0)) revert ZeroAddress();
        disputeContract = _dispute;
        emit DisputeContractSet(_dispute);
    }

    // -----------------------------------------------------------------------
    // Buyer functions
    // -----------------------------------------------------------------------

    function createEscrow(
        address seller,
        bytes32 orderRef
    ) external payable nonReentrant returns (uint256 escrowId) {
        if (seller == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert ZeroAmount();

        escrowId = nextEscrowId;
        unchecked {
            nextEscrowId = escrowId + 1;
        }

        escrows[escrowId] = Escrow({
            buyer:  msg.sender,
            seller: seller,
            amount: uint128(msg.value),
            status: STATUS_FUNDED
        });

        emit EscrowCreated(escrowId, msg.sender, seller, msg.value, orderRef);
    }

    function confirmReceived(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];

        if (e.buyer == address(0)) revert EscrowNotFound();
        if (e.status != STATUS_FUNDED) revert InvalidStatus();
        if (msg.sender != e.buyer) revert NotBuyer();

        address seller = e.seller;
        uint128 amount = e.amount;

        e.status = STATUS_RELEASED;

        (bool success, ) = payable(seller).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit EscrowReleased(escrowId);
    }

    // -----------------------------------------------------------------------
    // Oracle function — blocked while a dispute is active
    // -----------------------------------------------------------------------

    function oracleRelease(uint256 escrowId) external nonReentrant onlyOracle {
        if (frozen[escrowId]) revert Frozen();

        Escrow storage e = escrows[escrowId];

        if (e.buyer == address(0)) revert EscrowNotFound();
        if (e.status != STATUS_FUNDED) revert InvalidStatus();

        address seller = e.seller;
        uint128 amount = e.amount;

        e.status = STATUS_RELEASED;

        (bool success, ) = payable(seller).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit EscrowReleased(escrowId);
    }

    // -----------------------------------------------------------------------
    // Owner admin — manual refund to buyer
    // -----------------------------------------------------------------------

    function refundEscrow(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];

        if (e.buyer == address(0)) revert EscrowNotFound();
        if (e.status != STATUS_FUNDED) revert InvalidStatus();
        if (msg.sender != owner) revert NotOwner();

        address buyer  = e.buyer;
        uint128 amount = e.amount;

        e.status = STATUS_REFUNDED;

        (bool success, ) = payable(buyer).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit EscrowRefunded(escrowId);
    }

    // -----------------------------------------------------------------------
    // Dispute contract functions — called only by DePayDispute
    // -----------------------------------------------------------------------

    /// @notice Freeze an escrow so the oracle cannot auto-release during a dispute.
    function freeze(uint256 escrowId) external onlyDisputeContract {
        Escrow storage e = escrows[escrowId];
        if (e.buyer == address(0)) revert EscrowNotFound();
        if (e.status != STATUS_FUNDED) revert InvalidStatus();
        frozen[escrowId] = true;
        emit EscrowFrozen(escrowId);
    }

    /// @notice Release funds to seller as the outcome of a resolved dispute.
    function disputeRelease(uint256 escrowId) external nonReentrant onlyDisputeContract {
        Escrow storage e = escrows[escrowId];

        if (e.buyer == address(0)) revert EscrowNotFound();
        if (e.status != STATUS_FUNDED) revert InvalidStatus();

        address seller = e.seller;
        uint128 amount = e.amount;

        e.status         = STATUS_RELEASED;
        frozen[escrowId] = false;

        (bool success, ) = payable(seller).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit EscrowReleased(escrowId);
    }

    /// @notice Refund funds to buyer as the outcome of a resolved dispute.
    function disputeRefund(uint256 escrowId) external nonReentrant onlyDisputeContract {
        Escrow storage e = escrows[escrowId];

        if (e.buyer == address(0)) revert EscrowNotFound();
        if (e.status != STATUS_FUNDED) revert InvalidStatus();

        address buyer  = e.buyer;
        uint128 amount = e.amount;

        e.status         = STATUS_REFUNDED;
        frozen[escrowId] = false;

        (bool success, ) = payable(buyer).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit EscrowRefunded(escrowId);
    }

    // -----------------------------------------------------------------------
    // View
    // -----------------------------------------------------------------------

    function getEscrow(uint256 escrowId)
        external
        view
        returns (
            address buyer,
            address seller,
            uint128 amount,
            uint8   status
        )
    {
        Escrow storage e = escrows[escrowId];
        return (e.buyer, e.seller, e.amount, e.status);
    }
}
