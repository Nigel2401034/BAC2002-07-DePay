const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://root:password@localhost:27018/listings';
const DB_NAME = 'listings';
const COLLECTION_NAME = 'listings';

let db;
let client;

async function connectDB() {
  if (db) return db;
  
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    await db.collection(COLLECTION_NAME).createIndex({ seedKey: 1 }, { unique: true, sparse: true });
    console.log('✅ Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

async function createListing(listingData) {
  const collection = db.collection(COLLECTION_NAME);
  const result = await collection.insertOne({
    ...listingData,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return result.insertedId;
}

async function getAllListings() {
  const collection = db.collection(COLLECTION_NAME);
  return await collection.find({}).toArray();
}

async function getListingById(id) {
  const collection = db.collection(COLLECTION_NAME);
  return await collection.findOne({ _id: new ObjectId(id) });
}

async function getListingsBySellerWallet(sellerWallet) {
  const collection = db.collection(COLLECTION_NAME);
  return await collection.find({ sellerWallet: sellerWallet.toLowerCase() }).toArray();
}

async function updateListing(id, updateData) {
  const collection = db.collection(COLLECTION_NAME);
  const result = await collection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { ...updateData, updatedAt: new Date() } }
  );
  return result.modifiedCount > 0;
}

async function deleteListing(id) {
  const collection = db.collection(COLLECTION_NAME);
  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}

function getListingsCollection() {
  return db.collection(COLLECTION_NAME);
}

async function upsertListingBySeedKey(seedKey, listingData) {
  const collection = db.collection(COLLECTION_NAME);
  const now = new Date();

  const result = await collection.updateOne(
    { seedKey },
    {
      $set: {
        ...listingData,
        seedKey,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );

  if (result.upsertedCount > 0) {
    return { action: 'inserted', upsertedId: result.upsertedId };
  }

  return { action: 'updated' };
}

async function closeDB() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

module.exports = {
  connectDB,
  closeDB,
  createListing,
  getAllListings,
  getListingById,
  getListingsBySellerWallet,
  updateListing,
  deleteListing,
  getListingsCollection,
  upsertListingBySeedKey
};
