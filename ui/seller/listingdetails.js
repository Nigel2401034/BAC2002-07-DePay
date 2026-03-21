const subtitleEl = document.getElementById("listingDetailsSubtitle");
const statusEl = document.getElementById("listingDetailsStatus");
const bodyEl = document.getElementById("listingDetailsBody");
const reloadBtn = document.getElementById("reloadListingBtn");

const API_BASE_URL = "http://localhost:5000/api/listings";

function getListingIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || "";
}

function setStatus(message, type = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function renderListing(listing) {
  const title = listing.title || "Untitled";
  const fallbackImage = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='900' height='520'><rect width='100%' height='100%' fill='%230d1f2f'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%239fb4c8' font-size='28'>No Image</text></svg>";
  const imageUrl = listing.imageCid
    ? `${window.APP_CONFIG.ipfsGatewayBase}${listing.imageCid}`
    : (listing.imageFile ? `/baselistings/${listing.imageFile}` : fallbackImage);

  const listingCidLink = listing.ipfsCid
    ? `<a href="${window.APP_CONFIG.ipfsGatewayBase}${listing.ipfsCid}" target="_blank" rel="noopener noreferrer">${listing.ipfsCid}</a>`
    : "-";

  const imageCidLink = listing.imageCid
    ? `<a href="${window.APP_CONFIG.ipfsGatewayBase}${listing.imageCid}" target="_blank" rel="noopener noreferrer">${listing.imageCid}</a>`
    : "-";

  subtitleEl.textContent = title;

  bodyEl.innerHTML = `
    <article class="listing-details-layout">
      <div class="listing-details-media">
        <img class="listing-details-image" src="${imageUrl}" alt="${title}" onerror="this.src='${fallbackImage}'" />
      </div>

      <div class="listing-details-info">
        <h2 class="listing-details-title">${title}</h2>
        <p class="listing-details-price">${Number(listing.priceXsgd || 0).toFixed(2)} XSGD</p>
        <p class="listing-details-description">${listing.description || "No description"}</p>

        <div class="listing-details-grid">
          <p><strong>Category:</strong> ${listing.category || "General"}</p>
          <p><strong>Status:</strong> ${listing.status || "active"}</p>
          <p><strong>Seller:</strong> ${listing.sellerWallet || "-"}</p>
          <p><strong>Created:</strong> ${formatDate(listing.createdAt)}</p>
          <p><strong>Updated:</strong> ${formatDate(listing.updatedAt)}</p>
          <p><strong>Mongo ID:</strong> ${listing._id || "-"}</p>
          <p><strong>Listing CID:</strong> ${listingCidLink}</p>
          <p><strong>Image CID:</strong> ${imageCidLink}</p>
        </div>
      </div>
    </article>
  `;
}

async function loadListingDetails() {
  const listingId = getListingIdFromQuery();

  if (!listingId) {
    setStatus("Missing listing id in URL.", "error");
    bodyEl.innerHTML = '<p class="muted">Open this page from All Listings.</p>';
    subtitleEl.textContent = "No listing selected";
    return;
  }

  setStatus("Loading listing details...");
  bodyEl.innerHTML = '<p class="muted">Loading...</p>';

  try {
    const response = await fetch(`${API_BASE_URL}/${encodeURIComponent(listingId)}`);
    const payload = await response.json();

    if (!response.ok || !payload.success || !payload.listing) {
      throw new Error(payload.error || "Unable to load listing");
    }

    renderListing(payload.listing);
    setStatus("Listing loaded.", "ok");
  } catch (error) {
    setStatus(`Failed to load listing: ${error.message}`, "error");
    bodyEl.innerHTML = '<p class="muted">Try again after backend is running.</p>';
    subtitleEl.textContent = "Error";
  }
}

reloadBtn?.addEventListener("click", loadListingDetails);
document.addEventListener("DOMContentLoaded", loadListingDetails);
