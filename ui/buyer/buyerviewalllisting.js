const listingsContainer = document.getElementById("allListingsContainer");
const listingsCount = document.getElementById("allListingsCount");
const listingsStatus = document.getElementById("allListingsStatus");
const refreshBtn = document.getElementById("refreshListingsBtn");

const API_BASE_URL = "http://localhost:5000/api/listings";

function setStatus(message, type = "") {
  if (!listingsStatus) return;
  listingsStatus.textContent = message;
  listingsStatus.className = `status ${type}`.trim();
}

function getListingId(listing) {
  if (!listing) return "";
  if (typeof listing._id === "string") return listing._id;
  if (listing._id && typeof listing._id === "object" && listing._id.$oid) return listing._id.$oid;
  if (listing._id && typeof listing._id.toString === "function") return listing._id.toString();
  return "";
}

function renderListings(listings) {
  if (!Array.isArray(listings) || listings.length === 0) {
    listingsContainer.innerHTML = "<p class=\"muted\">No listings found.</p>";
    listingsCount.textContent = "0 listings";
    return;
  }

  listingsCount.textContent = `${listings.length} listing${listings.length > 1 ? "s" : ""}`;

  const rows = listings
    .map((listing) => {
      const title = listing.title || "Untitled";
      const price = Number(listing.priceXsgd || 0).toFixed(2);
      const listingId = getListingId(listing);
      const detailsUrl = `./buyerlistingdetails.html?id=${encodeURIComponent(listingId)}`;
      const fallbackImage = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='360'><rect width='100%' height='100%' fill='%230d1f2f'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%239fb4c8' font-size='24'>No Image</text></svg>";
      const imageUrl = listing.imageCid
        ? `${window.APP_CONFIG.ipfsGatewayBase}${listing.imageCid}`
        : (listing.imageFile ? `/baselistings/${listing.imageFile}` : fallbackImage);

      return `
        <a class="listing-rect-link" href="${detailsUrl}">
          <article class="listing-rect">
            <img class="listing-rect-image" src="${imageUrl}" alt="${title}" loading="lazy" onerror="this.src='${fallbackImage}'" />
            <div class="listing-rect-body">
              <h3 class="listing-rect-title">${title}</h3>
              <p class="listing-rect-price">${price} HLUSD</p>
            </div>
          </article>
        </a>
      `;
    })
    .join("");

  listingsContainer.innerHTML = `<div class="listing-rect-grid">${rows}</div>`;
}

async function loadAllListings() {
  setStatus("Loading listings...");
  listingsContainer.innerHTML = "<p class=\"muted\">Loading...</p>";

  try {
    const response = await fetch(API_BASE_URL);
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Failed to fetch listings");
    }

    renderListings(payload.listings || []);
    setStatus("Listings loaded.", "ok");
  } catch (error) {
    setStatus(`Unable to load listings: ${error.message}`, "error");
    listingsCount.textContent = "Error";
    listingsContainer.innerHTML = "<p class=\"muted\">Try refreshing after backend starts.</p>";
  }
}

refreshBtn?.addEventListener("click", loadAllListings);
document.addEventListener("DOMContentLoaded", loadAllListings);
