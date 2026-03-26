/**
 * DePayDispute — Full Demo Test Suite
 *
 * Run with:
 *   npx hardhat test test/Dispute.test.js
 *
 * Covers all 4 dispute flows + freeze guard + error cases.
 * Time is fast-forwarded locally so no real waiting needed.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// ── Constants ────────────────────────────────────────────────────────────────
const THREE_DAYS = 3 * 24 * 60 * 60;
const ORDER_REF  = ethers.encodeBytes32String("order-001");
const ESCROW_ID  = 0n;
const PRICE      = ethers.parseEther("1.0");

// ── Shared fixture ───────────────────────────────────────────────────────────
async function deployAll() {
  const [owner, buyer, seller, oracle, stranger] = await ethers.getSigners();

  // Deploy contracts
  const Escrow = await ethers.getContractFactory("DePayEscrow");
  const escrow = await Escrow.deploy(owner.address);

  const OrderTracking = await ethers.getContractFactory("OrderTracking");
  const tracking = await OrderTracking.deploy(owner.address);

  const Dispute = await ethers.getContractFactory("DePayDispute");
  const dispute = await Dispute.deploy(
    owner.address,
    await escrow.getAddress(),
    await tracking.getAddress()
  );

  // Wire up permissions
  await tracking.connect(owner).setOracle(oracle.address);
  await escrow.connect(owner).setOracle(oracle.address);
  await escrow.connect(owner).setDisputeContract(await dispute.getAddress());

  // Create one funded escrow (escrowId = 0)
  await escrow.connect(buyer).createEscrow(seller.address, ORDER_REF, { value: PRICE });

  // Register tracking record via oracle
  await tracking.connect(oracle).createTracking(ESCROW_ID, ORDER_REF);

  return { owner, buyer, seller, oracle, stranger, escrow, tracking, dispute };
}

// ── Test Suite ───────────────────────────────────────────────────────────────
describe("DePayDispute — Full Demo", function () {

  // ── Flow A ──────────────────────────────────────────────────────────────────
  describe("Flow A: Item already delivered → Seller wins immediately", function () {
    it("releases escrow to seller when tracking shows DELIVERED", async function () {
      const { buyer, seller, oracle, tracking, dispute } = await loadFixture(deployAll);

      // Oracle marks order as delivered
      await tracking.connect(oracle).updateStatus(ESCROW_ID, 2); // STATUS_DELIVERED

      const sellerBefore = await ethers.provider.getBalance(seller.address);

      // Buyer tries to dispute — but contract sees DELIVERED and settles for seller instantly
      await expect(dispute.connect(buyer).openDispute(ESCROW_ID))
        .to.emit(dispute, "DisputeOpened")
        .withArgs(ESCROW_ID, buyer.address, 1); // reason 1 = immediate seller win

      // Seller received the funds
      const sellerAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerAfter - sellerBefore).to.equal(PRICE);

      // Dispute is resolved
      const [,, state] = await dispute.getDispute(ESCROW_ID);
      expect(state).to.equal(4); // STATE_RESOLVED
    });
  });

  // ── Flow B ──────────────────────────────────────────────────────────────────
  describe("Flow B: Package stuck >3 days → Buyer wins immediately", function () {
    it("refunds buyer when SHIPPED with no update for over 3 days", async function () {
      const { buyer, oracle, tracking, dispute } = await loadFixture(deployAll);

      // Oracle ships the order
      await tracking.connect(oracle).updateStatus(ESCROW_ID, 1); // STATUS_SHIPPED

      // 3 days pass with no delivery update
      await time.increase(THREE_DAYS + 1);

      const buyerBefore = await ethers.provider.getBalance(buyer.address);

      const tx = await dispute.connect(buyer).openDispute(ESCROW_ID);
      await expect(tx)
        .to.emit(dispute, "DisputeOpened")
        .withArgs(ESCROW_ID, buyer.address, 2); // reason 2 = immediate buyer win

      // Buyer received refund (minus gas)
      const receipt  = await tx.wait();
      const gasCost  = receipt.gasUsed * receipt.gasPrice;
      const buyerAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerAfter - buyerBefore + gasCost).to.equal(PRICE);

      // Dispute is resolved
      const [,, state] = await dispute.getDispute(ESCROW_ID);
      expect(state).to.equal(4); // STATE_RESOLVED
    });
  });

  // ── Flow C ──────────────────────────────────────────────────────────────────
  describe("Flow C: Seller ignores dispute → Auto-refund buyer at deadline", function () {
    it("freezes escrow then refunds buyer when seller misses 3-day window", async function () {
      const { buyer, stranger, escrow, dispute } = await loadFixture(deployAll);

      // Status is PENDING (unclear) — deadline system starts
      await dispute.connect(buyer).openDispute(ESCROW_ID);

      // Escrow must now be frozen (oracle cannot release it)
      expect(await escrow.frozen(ESCROW_ID)).to.be.true;

      const [,, state, deadline] = await dispute.getDispute(ESCROW_ID);
      expect(state).to.equal(1); // STATE_AWAITING_SELLER

      // Seller does nothing — time runs out
      await time.increaseTo(deadline + 1n);

      const buyerBefore = await ethers.provider.getBalance(buyer.address);

      // Anyone can call enforceDeadline (stranger calls here)
      await expect(dispute.connect(stranger).enforceDeadline(ESCROW_ID))
        .to.emit(dispute, "DeadlineEnforced")
        .withArgs(ESCROW_ID, stranger.address, true); // true = buyer was refunded

      const buyerAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerAfter - buyerBefore).to.equal(PRICE);
    });

    it("pays seller when buyer misses their counter window", async function () {
      const { buyer, seller, stranger, dispute } = await loadFixture(deployAll);

      await dispute.connect(buyer).openDispute(ESCROW_ID);
      await dispute.connect(seller).sellerRespond(ESCROW_ID);

      // Buyer does nothing — buyer counter deadline expires
      const [,, , deadline] = await dispute.getDispute(ESCROW_ID);
      await time.increaseTo(deadline + 1n);

      const sellerBefore = await ethers.provider.getBalance(seller.address);

      await expect(dispute.connect(stranger).enforceDeadline(ESCROW_ID))
        .to.emit(dispute, "DeadlineEnforced")
        .withArgs(ESCROW_ID, stranger.address, false); // false = seller was paid

      const sellerAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerAfter - sellerBefore).to.equal(PRICE);
    });
  });

  // ── Flow D ──────────────────────────────────────────────────────────────────
  describe("Flow D: Both respond → Admin arbitrates", function () {
    it("reaches STATE_AWAITING_ADMIN after buyer counters seller", async function () {
      const { buyer, seller, dispute } = await loadFixture(deployAll);

      await dispute.connect(buyer).openDispute(ESCROW_ID);

      await expect(dispute.connect(seller).sellerRespond(ESCROW_ID))
        .to.emit(dispute, "SellerResponded");

      await expect(dispute.connect(buyer).buyerCounter(ESCROW_ID))
        .to.emit(dispute, "BuyerCountered");

      const [,, state, deadline] = await dispute.getDispute(ESCROW_ID);
      expect(state).to.equal(3);    // STATE_AWAITING_ADMIN
      expect(deadline).to.equal(0n); // no deadline — admin decides at their discretion
    });

    it("admin resolves in buyer's favour → buyer refunded", async function () {
      const { owner, buyer, seller, dispute } = await loadFixture(deployAll);

      await dispute.connect(buyer).openDispute(ESCROW_ID);
      await dispute.connect(seller).sellerRespond(ESCROW_ID);
      await dispute.connect(buyer).buyerCounter(ESCROW_ID);

      const buyerBefore = await ethers.provider.getBalance(buyer.address);

      await expect(dispute.connect(owner).adminResolve(ESCROW_ID, true))
        .to.emit(dispute, "AdminResolved")
        .withArgs(ESCROW_ID, true);

      const buyerAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerAfter - buyerBefore).to.equal(PRICE);
    });

    it("admin resolves in seller's favour → seller paid", async function () {
      const { owner, buyer, seller, dispute } = await loadFixture(deployAll);

      await dispute.connect(buyer).openDispute(ESCROW_ID);
      await dispute.connect(seller).sellerRespond(ESCROW_ID);
      await dispute.connect(buyer).buyerCounter(ESCROW_ID);

      const sellerBefore = await ethers.provider.getBalance(seller.address);

      await expect(dispute.connect(owner).adminResolve(ESCROW_ID, false))
        .to.emit(dispute, "AdminResolved")
        .withArgs(ESCROW_ID, false);

      const sellerAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerAfter - sellerBefore).to.equal(PRICE);
    });
  });

  // ── Freeze guard ────────────────────────────────────────────────────────────
  describe("Freeze guard: Oracle cannot release a disputed escrow", function () {
    it("oracle release is blocked while dispute is active", async function () {
      const { buyer, oracle, escrow, dispute } = await loadFixture(deployAll);

      await dispute.connect(buyer).openDispute(ESCROW_ID); // freezes escrow

      await expect(escrow.connect(oracle).oracleRelease(ESCROW_ID))
        .to.be.revertedWithCustomError(escrow, "Frozen");
    });
  });

  // ── Error cases ─────────────────────────────────────────────────────────────
  describe("Error cases: Wrong caller / wrong state / wrong timing", function () {
    it("reverts with NotBuyer if non-buyer opens dispute", async function () {
      const { seller, dispute } = await loadFixture(deployAll);
      await expect(dispute.connect(seller).openDispute(ESCROW_ID))
        .to.be.revertedWithCustomError(dispute, "NotBuyer");
    });

    it("reverts with DisputeAlreadyActive on duplicate open", async function () {
      const { buyer, dispute } = await loadFixture(deployAll);
      await dispute.connect(buyer).openDispute(ESCROW_ID);
      await expect(dispute.connect(buyer).openDispute(ESCROW_ID))
        .to.be.revertedWithCustomError(dispute, "DisputeAlreadyActive");
    });

    it("reverts with DeadlineNotPassed if enforceDeadline called too early", async function () {
      const { buyer, dispute } = await loadFixture(deployAll);
      await dispute.connect(buyer).openDispute(ESCROW_ID);
      await expect(dispute.enforceDeadline(ESCROW_ID))
        .to.be.revertedWithCustomError(dispute, "DeadlineNotPassed");
    });

    it("reverts with DeadlineExpired if seller responds after deadline", async function () {
      const { buyer, seller, dispute } = await loadFixture(deployAll);
      await dispute.connect(buyer).openDispute(ESCROW_ID);
      const [,,, deadline] = await dispute.getDispute(ESCROW_ID);
      await time.increaseTo(deadline + 1n);
      await expect(dispute.connect(seller).sellerRespond(ESCROW_ID))
        .to.be.revertedWithCustomError(dispute, "DeadlineExpired");
    });

    it("reverts with NotOwner if non-admin calls adminResolve", async function () {
      const { buyer, seller, stranger, dispute } = await loadFixture(deployAll);
      await dispute.connect(buyer).openDispute(ESCROW_ID);
      await dispute.connect(seller).sellerRespond(ESCROW_ID);
      await dispute.connect(buyer).buyerCounter(ESCROW_ID);
      await expect(dispute.connect(stranger).adminResolve(ESCROW_ID, true))
        .to.be.revertedWithCustomError(dispute, "NotOwner");
    });
  });
});
