const cartListEl = document.getElementById("cartList");
const cartStatusEl = document.getElementById("cartStatus");
const cartSelectionSummaryEl = document.getElementById("cartSelectionSummary");
const checkoutSelectedBtn = document.getElementById("checkoutSelectedBtn");
const selectAllCartBtn = document.getElementById("selectAllCartBtn");
const clearSelectionCartBtn = document.getElementById("clearSelectionCartBtn");
const clearCartBtn = document.getElementById("clearCartBtn");

const CART_STORAGE_KEY = "buyerCartItems";
const CHECKOUT_SELECTION_KEY = "buyerCheckoutSelection";
const MIN_QTY = 1;
const MAX_QTY = 99;

function setStatus(message, type = "") {
  if (!cartStatusEl) return;
  cartStatusEl.textContent = message;
  cartStatusEl.className = `status ${type}`.trim();
}

function getCartItems() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return MIN_QTY;
  if (parsed < MIN_QTY) return MIN_QTY;
  if (parsed > MAX_QTY) return MAX_QTY;
  return parsed;
}

function saveCartItems(items) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  document.dispatchEvent(new CustomEvent("buyer-cart-updated"));
}

function getSelectedIds() {
  const checkedBoxes = cartListEl
    ? cartListEl.querySelectorAll(".cart-item-checkbox:checked")
    : [];
  return Array.from(checkedBoxes).map((node) => node.value);
}

function getCartItemImage(item) {
  const fallbackImage =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='220'><rect width='100%' height='100%' fill='%230d1f2f'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%239fb4c8' font-size='20'>No Image</text></svg>";
  if (item.imageCid) {
    return `${window.APP_CONFIG.ipfsGatewayBase}${item.imageCid}`;
  }
  if (item.imageFile) {
    return `/baselistings/${item.imageFile}`;
  }
  return fallbackImage;
}

function updateSummary() {
  const items = getCartItems();
  const selectedIds = getSelectedIds();
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const selectedQty = selectedItems.reduce(
    (sum, item) => sum + normalizeQuantity(item.quantity || 1),
    0,
  );
  const total = selectedItems.reduce((sum, item) => {
    const qty = normalizeQuantity(item.quantity || 1);
    return sum + Number(item.priceXsgd || 0) * qty;
  }, 0);

  if (cartSelectionSummaryEl) {
    cartSelectionSummaryEl.textContent = `${
      selectedItems.length
    } selected (${selectedQty} qty) | ${total.toFixed(2)} XSGD`;
  }

  if (checkoutSelectedBtn) {
    checkoutSelectedBtn.disabled = selectedItems.length === 0;
  }
}

function updateItemQuantity(itemId, quantity) {
  const items = getCartItems();
  const qty = normalizeQuantity(quantity);
  const updated = items.map((item) => {
    if (item.id !== itemId) return item;
    return {
      ...item,
      quantity: qty,
      updatedAt: new Date().toISOString(),
    };
  });

  saveCartItems(updated);
}

function removeCartItem(itemId) {
  const items = getCartItems();
  const filtered = items.filter((item) => item.id !== itemId);
  saveCartItems(filtered);
  renderCart();
}

function renderCart() {
  const items = getCartItems();

  if (!Array.isArray(items) || items.length === 0) {
    cartListEl.innerHTML = '<p class="muted">Your cart is empty.</p>';
    if (cartSelectionSummaryEl) {
      cartSelectionSummaryEl.textContent = "0 selected";
    }
    if (checkoutSelectedBtn) {
      checkoutSelectedBtn.disabled = true;
    }
    setStatus("Cart is empty.");
    return;
  }

  const html = items
    .map((item) => {
      const imageUrl = getCartItemImage(item);
      return `
        <article class="cart-row" data-item-id="${item.id}">
          <label class="cart-select-wrap" title="Select for checkout">
            <input type="checkbox" class="cart-item-checkbox" value="${
              item.id
            }" checked />
          </label>
          <img class="cart-thumb" src="${imageUrl}" alt="${
        item.title || "Untitled"
      }" />
          <div class="cart-row-content">
            <h3>${item.title || "Untitled"}</h3>
            <p class="muted">${item.description || "No description"}</p>
            <p class="cart-meta">${Number(item.priceXsgd || 0).toFixed(
              2,
            )} XSGD each</p>
            <div class="cart-qty-row">
              <button type="button" class="button-link cart-qty-btn" data-qty-action="decrease" data-item-id="${
                item.id
              }">-</button>
              <label class="cart-qty-label">
                Qty
                <input
                  type="number"
                  min="${MIN_QTY}"
                  max="${MAX_QTY}"
                  step="1"
                  class="cart-qty-input"
                  data-qty-id="${item.id}"
                  value="${normalizeQuantity(item.quantity || 1)}"
                />
              </label>
              <button type="button" class="button-link cart-qty-btn" data-qty-action="increase" data-item-id="${
                item.id
              }">+</button>
            </div>
            <p class="cart-meta">Subtotal: ${(
              Number(item.priceXsgd || 0) *
              normalizeQuantity(item.quantity || 1)
            ).toFixed(2)} XSGD</p>
            <p class="cart-meta">Seller: ${item.sellerWallet || "-"}</p>
          </div>
          <button type="button" class="button-link cart-remove-btn" data-remove-id="${
            item.id
          }">Remove</button>
        </article>
      `;
    })
    .join("");

  cartListEl.innerHTML = `<div class="cart-list">${html}</div>`;

  const checkboxes = cartListEl.querySelectorAll(".cart-item-checkbox");
  checkboxes.forEach((node) => {
    node.addEventListener("change", updateSummary);
  });

  const removeBtns = cartListEl.querySelectorAll(".cart-remove-btn");
  removeBtns.forEach((node) => {
    node.addEventListener("click", () => {
      removeCartItem(node.dataset.removeId || "");
    });
  });

  const qtyInputs = cartListEl.querySelectorAll(".cart-qty-input");
  qtyInputs.forEach((node) => {
    node.addEventListener("change", () => {
      const nextQty = normalizeQuantity(node.value);
      node.value = String(nextQty);
      updateItemQuantity(node.dataset.qtyId || "", nextQty);
      renderCart();
    });
  });

  const qtyBtns = cartListEl.querySelectorAll(".cart-qty-btn");
  qtyBtns.forEach((node) => {
    node.addEventListener("click", () => {
      const itemId = node.dataset.itemId || "";
      const action = node.dataset.qtyAction || "";
      const currentItems = getCartItems();
      const target = currentItems.find((item) => item.id === itemId);
      const currentQty = normalizeQuantity(target?.quantity || 1);
      const nextQty = action === "decrease" ? currentQty - 1 : currentQty + 1;
      updateItemQuantity(itemId, nextQty);
      renderCart();
    });
  });

  updateSummary();
  setStatus("Cart loaded.", "ok");
}

selectAllCartBtn?.addEventListener("click", () => {
  cartListEl?.querySelectorAll(".cart-item-checkbox").forEach((node) => {
    node.checked = true;
  });
  updateSummary();
});

clearSelectionCartBtn?.addEventListener("click", () => {
  cartListEl?.querySelectorAll(".cart-item-checkbox").forEach((node) => {
    node.checked = false;
  });
  updateSummary();
});

clearCartBtn?.addEventListener("click", () => {
  saveCartItems([]);
  renderCart();
});

checkoutSelectedBtn?.addEventListener("click", () => {
  const selectedIds = getSelectedIds();
  if (selectedIds.length === 0) {
    setStatus("Please select at least one item.", "error");
    return;
  }

  const cartItems = getCartItems();
  const selectedItems = cartItems.filter((item) =>
    selectedIds.includes(item.id),
  );
  const payload = selectedItems.map((item) => ({
    id: item.id,
    quantity: normalizeQuantity(item.quantity || 1),
  }));

  sessionStorage.setItem(CHECKOUT_SELECTION_KEY, JSON.stringify(payload));
  window.location.href = "./checkout.html";
});

document.addEventListener("DOMContentLoaded", renderCart);
