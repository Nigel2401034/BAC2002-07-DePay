require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const listingsRouter = require("./routes");
const ordersRouter = require("./orders-routes");
const oracleRouter = require("../oracle/oracle-routes");
const { seedListingsOnStartup } = require('./seed-listings');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static UI files
app.use(express.static(path.join(__dirname, "../ui")));
app.use(
  "/baselistings",
  express.static(path.join(__dirname, "../baselistings")),
);

let dbConnected = false;

// Initialize database connection
async function initializeDB() {
  try {
    await db.connectDB();
    dbConnected = true;
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
    process.exit(1);
  }
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    database: dbConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/listings", listingsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/oracle", oracleRouter);

// Serve index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../ui/index.html"));
});

// Serve buyer landing page
app.get("/buyer", (req, res) => {
  res.sendFile(path.join(__dirname, "../ui/buyer/buyer.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("⚠️ Unhandled error:", err.message);
  res.status(500).json({
    error: "Internal server error",
    details: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
async function start() {
  try {
    await initializeDB();
    await seedListingsOnStartup();
    app.listen(PORT, () => {
      console.log("\n" + "=".repeat(60));
      console.log("🚀 DePay App Started");
      console.log("=".repeat(60));
      console.log(`http://localhost:${PORT}`);
      console.log("=".repeat(60) + "\n");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n⏹️  Shutting down gracefully...");
  await db.closeDB();
  process.exit(0);
});

start();
