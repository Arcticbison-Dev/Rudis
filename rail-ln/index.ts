import express from "express";
import { config } from "dotenv";

config();

const app = express();
app.use(express.json());

const ALT_PAYMENTS_BASE = process.env.ALT_PAYMENTS_BASE || "http://localhost:5000";
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
const PORT = parseInt(process.env.PORT || "5001", 10);

if (!RAIL_AUTH_TOKEN) {
  console.error("ERROR: RAIL_AUTH_TOKEN not set");
  process.exit(1);
}

app.post("/create", async (req, res) => {
  try {
    const { invoiceId, amountSats, description } = req.body;
    
    if (!invoiceId || !amountSats) {
      return res.status(400).json({ error: "Missing invoiceId or amountSats" });
    }

    const bolt11 = `lnbc${amountSats}n1placeholder`;
    
    console.log(`✓ Lightning invoice created: ${bolt11} for invoice ${invoiceId}`);
    
    res.json({
      bolt11,
      amountSats,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
  } catch (error: any) {
    console.error("Error creating Lightning invoice:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/settled", async (req, res) => {
  try {
    const { invoiceId, preimage, settledAt } = req.body;
    
    console.log(`✓ Lightning payment settled for invoice ${invoiceId}`);
    
    const response = await fetch(`${ALT_PAYMENTS_BASE}/api/rails/ln/settled`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        invoiceId,
        transactionId: preimage || `preimage_${Date.now()}`,
        confirmations: 1,
      }),
    });

    if (!response.ok) {
      console.error(`Failed to notify payments service: ${response.status}`);
      return res.status(500).json({ error: "Callback failed" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error processing settlement:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rail-ln" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Lightning rail service running on port ${PORT}`);
});
