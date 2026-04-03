const fs = require("fs");
const path = require("path");
const db = require("./db");
const { uploadJSONToIPFS, uploadFilePathToIPFS } = require("./ipfs");

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

async function seedListingsOnStartup() {
  const shouldSeed = parseBoolean(process.env.SEED_LISTINGS_ON_START, true);
  if (!shouldSeed) {
    console.log("ℹ️  Seed listings skipped (SEED_LISTINGS_ON_START=false).");
    return;
  }

  const listingsPath = path.join(__dirname, "../baselistings/listings.json");
  if (!fs.existsSync(listingsPath)) {
    console.log("ℹ️  Seed listings file not found, skipping startup seed.");
    return;
  }

  const raw = fs.readFileSync(listingsPath, "utf8");
  let seedListings;

  try {
    seedListings = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in baselistings/listings.json: ${error.message}`,
    );
  }

  if (!Array.isArray(seedListings) || seedListings.length === 0) {
    console.log("ℹ️  No seed listings found in baselistings/listings.json.");
    return;
  }

  const allowIpfsUpload = Boolean(process.env.PINATA_JWT);

  let insertedCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < seedListings.length; i += 1) {
    const item = seedListings[i] || {};
    const fallbackSeedKey = `seed-listing-${i + 1}`;
    const seedKey = String(item.seedKey || fallbackSeedKey).trim();
    const existingDoc = await db.getListingsCollection().findOne({ seedKey });

    const listingData = {
      title: String(item.title || `Listing ${i + 1}`).trim(),
      description: String(item.description || "").trim(),
      priceXsgd: Number(item.priceXsgd || 0),
      category: String(item.category || "General").trim(),
      status: String(item.status || "active").trim(),
      imageFile: item.imageFile ? String(item.imageFile).trim() : null,
      imageCid: item.imageCid
        ? String(item.imageCid).trim()
        : existingDoc && existingDoc.imageCid
        ? existingDoc.imageCid
        : null,
      ipfsCid: item.ipfsCid
        ? String(item.ipfsCid).trim()
        : existingDoc && existingDoc.ipfsCid
        ? existingDoc.ipfsCid
        : null,
      sellerWallet: String(item.sellerWallet || "").toLowerCase(),
      source: "seed",
    };

    if (!listingData.imageCid && allowIpfsUpload && listingData.imageFile) {
      const imagePath = path.join(
        __dirname,
        "../baselistings",
        listingData.imageFile,
      );
      if (fs.existsSync(imagePath)) {
        try {
          listingData.imageCid = await uploadFilePathToIPFS(
            imagePath,
            listingData.imageFile,
          );
        } catch (error) {
          console.log(
            `⚠️  Image upload failed for ${seedKey}. Continuing without image CID.`,
          );
        }
      }
    }

    if (!listingData.ipfsCid && allowIpfsUpload) {
      try {
        const cid = await uploadJSONToIPFS(listingData, `seed-${seedKey}`);
        listingData.ipfsCid = cid;
      } catch (error) {
        console.log(
          `⚠️  IPFS upload failed for ${seedKey}. Continuing without CID.`,
        );
      }
    } else if (listingData.ipfsCid) {
      console.log(
        `ℹ️  Using existing CID for ${seedKey}: ${listingData.ipfsCid}`,
      );
    }

    const upsertResult = await db.upsertListingBySeedKey(seedKey, listingData);
    if (upsertResult.action === "inserted") insertedCount += 1;
    if (upsertResult.action === "updated") updatedCount += 1;
  }

  console.log(
    `🌱 Seed completed: inserted=${insertedCount}, updated=${updatedCount}, total=${seedListings.length}`,
  );
}

module.exports = { seedListingsOnStartup };
