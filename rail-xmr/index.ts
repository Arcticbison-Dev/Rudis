import express from "express";
import { config } from "dotenv";

config();

const app = express();
app.use(express.json());

const ALT_PAYMENTS_BASE = process.env.ALT_PAYMENTS_BASE || "http://localhost:5000";
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
const PORT = parseInt(process.env.PORT || "5003", 10);

if (!RAIL_AUTH_TOKEN) {
  console.error("ERROR: RAIL_AUTH_TOKEN not set");
  process.exit(1);
}

let subaddressIndex = 0;

app.post("/create", async (req, res) => {
  try {
    const { invoiceId } = req.body;
    
    if (!invoiceId) {
      return res.status(400).json({ error: "Missing invoiceId" });
    }

    const subaddress = `8${subaddressIndex++}placeholder`;
    
    console.log(`✓ Monero subaddress created: ${subaddress} for invoice ${invoiceId}`);
    
    res.json({
      subaddress,
      accountIndex: 0,
      addressIndex: subaddressIndex,
    });
  } catch (error: any) {
    console.error("Error creating Monero subaddress:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/confirmed", async (req, res) => {
  try {
    const { invoiceId, txHash, confirmations, blockHeight } = req.body;
    
    console.log(`✓ Monero payment confirmed for invoice ${invoiceId}, tx: ${txHash}`);
    
    const response = await fetch(`${ALT_PAYMENTS_BASE}/api/rails/xmr/confirmed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        invoiceId,
        transactionId: txHash,
        confirmations,
        blockHeight,
      }),
    });

    if (!response.ok) {
      console.error(`Failed to notify payments service: ${response.status}`);
      return res.status(500).json({ error: "Callback failed" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error processing confirmation:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rail-xmr" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Monero rail service running on port ${PORT}`);
});
