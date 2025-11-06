import express from "express";
import { config } from "dotenv";

config();

const app = express();
app.use(express.json());

const ALT_PAYMENTS_BASE = process.env.ALT_PAYMENTS_BASE || "http://localhost:5000";
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
const PORT = parseInt(process.env.PORT || "5002", 10);

if (!RAIL_AUTH_TOKEN) {
  console.error("ERROR: RAIL_AUTH_TOKEN not set");
  process.exit(1);
}

let addressIndex = 0;

app.post("/create", async (req, res) => {
  try {
    const { invoiceId } = req.body;
    
    if (!invoiceId) {
      return res.status(400).json({ error: "Missing invoiceId" });
    }

    const address = `bc1qplaceholder${addressIndex++}`;
    
    console.log(`✓ Bitcoin address derived: ${address} for invoice ${invoiceId}`);
    
    res.json({
      address,
      derivationPath: `m/84'/0'/0'/0/${addressIndex}`,
    });
  } catch (error: any) {
    console.error("Error creating Bitcoin address:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/confirmed", async (req, res) => {
  try {
    const { invoiceId, txHash, confirmations, blockHeight } = req.body;
    
    console.log(`✓ Bitcoin payment confirmed for invoice ${invoiceId}, tx: ${txHash}`);
    
    const response = await fetch(`${ALT_PAYMENTS_BASE}/api/rails/btc/confirmed`, {
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
  res.json({ ok: true, service: "rail-btc" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Bitcoin rail service running on port ${PORT}`);
});
