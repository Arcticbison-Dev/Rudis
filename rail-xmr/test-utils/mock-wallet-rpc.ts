import express from "express";
import { createHash } from "crypto";

const app = express();
app.use(express.json());

// Mock wallet state
const mockSubaddresses = new Map<number, { address: string; label: string }>();
const mockTransfers = new Map<string, any[]>(); // subaddress -> transfers
let nextAddressIndex = 1;

// Generate deterministic mock Monero address
function generateMockSubaddress(addressIndex: number): string {
  const hash = createHash("sha256")
    .update(`mock-xmr-${addressIndex}`)
    .digest("hex")
    .substring(0, 95);
  return `8${hash}`;
}

// JSON-RPC endpoint
app.post("/json_rpc", (req, res) => {
  const { method, params, id } = req.body;

  console.log(JSON.stringify({ 
    service: "mock-wallet-rpc", 
    method, 
    params: params ? Object.keys(params) : [] 
  }));

  // create_address - Generate new subaddress
  if (method === "create_address") {
    const accountIndex = params.account_index || 0;
    const label = params.label || "";
    const addressIndex = nextAddressIndex++;
    const address = generateMockSubaddress(addressIndex);

    mockSubaddresses.set(addressIndex, { address, label });
    mockTransfers.set(address, []); // Initialize empty transfers

    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        address,
        address_index: addressIndex,
      },
    });
  }

  // get_transfers - Get incoming transfers
  if (method === "get_transfers") {
    const accountIndex = params.account_index || 0;
    const subaddrIndices = params.subaddr_indices || [];

    // Get transfers for requested subaddresses
    let allTransfers: any[] = [];
    for (const [addrIndex, { address }] of mockSubaddresses.entries()) {
      if (subaddrIndices.includes(addrIndex)) {
        const transfers = mockTransfers.get(address) || [];
        allTransfers.push(...transfers);
      }
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        in: allTransfers,
      },
    });
  }

  // get_height - Current blockchain height
  if (method === "get_height") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        height: 3000000, // Mock height
      },
    });
  }

  // Default error for unsupported methods
  res.json({
    jsonrpc: "2.0",
    id,
    error: {
      code: -1,
      message: `Method '${method}' not implemented in mock`,
    },
  });
});

// Helper endpoint to simulate receiving a payment (test use only)
app.post("/test/simulate-payment", (req, res) => {
  const { subaddress, amountAtomic, confirmations } = req.body;

  const transfers = mockTransfers.get(subaddress);
  if (!transfers) {
    return res.status(404).json({ error: "Subaddress not found" });
  }

  // Generate mock transaction
  const txid = createHash("sha256")
    .update(`tx-${Date.now()}-${subaddress}`)
    .digest("hex");

  const transfer = {
    txid,
    amount: parseInt(amountAtomic),
    confirmations: confirmations || 0,
    height: 3000000,
    timestamp: Math.floor(Date.now() / 1000),
    subaddr_index: {
      major: 0,
      minor: Array.from(mockSubaddresses.entries()).find(
        ([_, data]) => data.address === subaddress
      )?.[0] || 0,
    },
  };

  transfers.push(transfer);

  console.log(JSON.stringify({ 
    service: "mock-wallet-rpc", 
    event: "payment_simulated",
    subaddress: subaddress.substring(0, 12) + "...",
    amountAtomic,
    confirmations 
  }));

  res.json({ success: true, txid });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "mock-wallet-rpc" });
});

const PORT = parseInt(process.env.MOCK_RPC_PORT || "18082");
app.listen(PORT, "127.0.0.1", () => {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║       Mock Monero Wallet RPC (Testing Only)              ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║ Port:         ${PORT.toString().padEnd(46)}║`);
  console.log("║ Status:       ✓ READY FOR TESTING                         ║");
  console.log("║ Warning:      NOT FOR PRODUCTION USE                      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Test endpoints:");
  console.log(`  POST http://127.0.0.1:${PORT}/json_rpc - Standard RPC`);
  console.log(`  POST http://127.0.0.1:${PORT}/test/simulate-payment - Simulate payment`);
  console.log("");
});
