const express = require('express');
const multer = require('multer');
const { uploadJSONToIPFS, uploadBufferToIPFS } = require('./ipfs');
const db = require('./db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/listings - Create a new listing
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { sellerWallet, title, description, priceXsgd } = req.body;

    if (!sellerWallet || !title || !description || !priceXsgd) {
      return res.status(400).json({ error: 'Missing required fields: sellerWallet, title, description, priceXsgd' });
    }

    // Prepare listing data
    const listingData = {
      title,
      description,
      priceXsgd: parseFloat(priceXsgd),
      sellerWallet: sellerWallet.toLowerCase(),
      status: 'active'
    };

    // Upload image to IPFS first and store its CID in metadata
    if (req.file) {
      listingData.imageName = req.file.originalname;
      listingData.imageCid = await uploadBufferToIPFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      console.log(`📸 Image included: ${req.file.originalname}`);
    }

    // Upload listing metadata to IPFS
    const listingCid = await uploadJSONToIPFS(listingData, `listing-${Date.now()}`);
    listingData.ipfsCid = listingCid;

    // Store in MongoDB
    const listingId = await db.createListing(listingData);

    res.status(201).json({
      success: true,
      message: 'Listing created successfully',
      listingId: listingId.toString(),
      ipfsCid: listingCid,
      sellerWallet: sellerWallet.toLowerCase()
    });
  } catch (error) {
    console.error('❌ Error creating listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/listings - Get all listings
router.get('/', async (req, res) => {
  try {
    const listings = await db.getAllListings();
    res.json({
      success: true,
      total: listings.length,
      listings
    });
  } catch (error) {
    console.error('❌ Error fetching listings:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/listings/:id - Get a specific listing by ID
router.get('/:id', async (req, res) => {
  try {
    const listing = await db.getListingById(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    res.json({
      success: true,
      listing
    });
  } catch (error) {
    console.error('❌ Error fetching listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/listings/seller/:wallet - Get listings by seller wallet
router.get('/seller/:wallet', async (req, res) => {
  try {
    const listings = await db.getListingsBySellerWallet(req.params.wallet);
    res.json({
      success: true,
      total: listings.length,
      listings
    });
  } catch (error) {
    console.error('❌ Error fetching seller listings:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/listings/:id - Update a listing
router.put('/:id', async (req, res) => {
  try {
    const { title, description, priceXsgd, status } = req.body;
    const updateData = {};

    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (priceXsgd) updateData.priceXsgd = parseFloat(priceXsgd);
    if (status) updateData.status = status;

    const updated = await db.updateListing(req.params.id, updateData);
    if (!updated) {
      return res.status(404).json({ error: 'Listing not found or no changes made' });
    }

    res.json({ success: true, message: 'Listing updated successfully' });
  } catch (error) {
    console.error('❌ Error updating listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/listings/:id - Delete a listing
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await db.deleteListing(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    res.json({ success: true, message: 'Listing deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting listing:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
