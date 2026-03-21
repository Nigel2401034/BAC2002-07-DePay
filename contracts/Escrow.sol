// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract DePayEscrow is ReentrancyGuard {
    uint8 private constant STATUS_FUNDED = 1;
    uint8 private constant STATUS_RELEASED = 2;
    uint8 private constant STATUS_REFUNDED = 3;

    struct Escrow {
        address buyer;
        address seller;
        uint128 amount;
        uint8 status;
    }

    address public immutable owner;
    uint256 public nextEscrowId;

    mapping(uint256 => Escrow) private escrows;

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        bytes32 orderRef
    );

    event EscrowReleased(uint256 indexed escrowId);
    event EscrowRefunded(uint256 indexed escrowId);

    error ZeroAddress();
    error ZeroAmount();
    error NotOwner();
    error NotBuyer();
    error InvalidStatus();
    error EscrowNotFound();
    error TransferFailed();

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
    }

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
            buyer: msg.sender,
            seller: seller,
            amount: uint128(msg.value),
            status: STATUS_FUNDED
        });

        emit EscrowCreated(
            escrowId,
            msg.sender,
            seller,
            msg.value,
            orderRef
        );
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

    function refundEscrow(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];

        if (e.buyer == address(0)) revert EscrowNotFound();
        if (e.status != STATUS_FUNDED) revert InvalidStatus();
        if (msg.sender != owner) revert NotOwner();

        address buyer = e.buyer;
        uint128 amount = e.amount;

        e.status = STATUS_REFUNDED;

        (bool success, ) = payable(buyer).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit EscrowRefunded(escrowId);
    }

    function getEscrow(uint256 escrowId)
        external
        view
        returns (
            address buyer,
            address seller,
            uint128 amount,
            uint8 status
        )
    {
        Escrow storage e = escrows[escrowId];
        return (e.buyer, e.seller, e.amount, e.status);
    }
}