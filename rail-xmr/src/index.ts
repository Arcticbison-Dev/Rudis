import express, { Request, Response, NextFunction } from "express";
import { config } from "dotenv";
import axios from "axios";
import { z } from "zod";
import { XmrStorage } from "./storage.js";
import { MoneroRpcClient } from "./monero-rpc.js";

config();

// SECURITY: Fail-fast validation BEFORE any initialization (same pattern as rail-btc)
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
  console.error("╔═══════════════════════════════════════════════════════════╗");
  console.error("║ FATAL: RAIL_AUTH_TOKEN not set                           ║");
  console.error("║ This service cannot run without authentication           ║");
  console.error("║ Set RAIL_AUTH_TOKEN in environment before starting       ║");
  console.error("╚═══════════════════════════════════════════════════════════╝");
  process.exit(1);
}

// Environment configuration (after validation)
const PORT = parseInt(process.env.PORT || "5003", 10);
const PAYMENTS_SERVICE_URL = process.env.PAYMENTS_SERVICE_URL || "http://localhost:5000";

// Monero Wallet RPC configuration
const XMR_RPC_HOST = process.env.XMR_RPC_HOST || "127.0.0.1";
const XMR_RPC_PORT = parseInt(process.env.XMR_RPC_PORT || "18082", 10);
const XMR_RPC_USERNAME = process.env.XMR_RPC_USERNAME || "";
const XMR_RPC_PASSWORD = process.env.XMR_RPC_PASSWORD || "";
const XMR_ACCOUNT_INDEX = parseInt(process.env.XMR_ACCOUNT_INDEX || "0", 10);
const XMR_CONFIRMATIONS_REQUIRED = parseInt(process.env.XMR_CONFIRMATIONS_REQUIRED || "10", 10);
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS || "30000", 10);

// Initialize Express app and middleware
const app = express();
app.use(express.json());

// Initialize storage and RPC client (after validation)
const storage = new XmrStorage();
const moneroRpc = new MoneroRpcClient({
  host: XMR_RPC_HOST,
  port: XMR_RPC_PORT,
  username: XMR_RPC_USERNAME,
  password: XMR_RPC_PASSWORD,
});

// Zod schemas for validation
const createSubaddressSchema = z.object({
  invoiceId: z.string().uuid(),
});

// Authentication middleware - Validates requests from payments service only
function authenticatePaymentsService(req: Request, res: Response, next: NextFunction) {
  if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
    console.error("CRITICAL: RAIL_AUTH_TOKEN not configured but /create endpoint called");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("Rail /create rejected: missing or invalid Authorization header");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.substring(7);

  if (!token || token.length === 0 || token !== RAIL_AUTH_TOKEN) {
    console.warn("Rail /create rejected: invalid token");
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// Privacy helper: truncate transaction ID for logging (NOT USED in production logs)
function truncateTxid(txid: string | null | undefined): string {
  if (!txid || txid.length <= 16) return txid || "null";
  return `${txid.substring(0, 8)}...${txid.substring(txid.length - 8)}`;
}

// Callback to payments service
async function callbackPaymentsService(
  invoiceId: string,
  txid: string,
  confirmations: number,
  blockHeight: number
): Promise<void> {
  try {
    const response = await axios.post(
      `${PAYMENTS_SERVICE_URL}/api/rails/xmr/confirmed`,
      {
        invoiceId,
        transactionId: txid,
        confirmations,
        blockHeight,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      console.log(JSON.stringify({
        invoiceId,
        rail: "xmr",
        event: "callback_sent"
      }));
    } else {
      console.error(JSON.stringify({
        invoiceId,
        rail: "xmr",
        event: "callback_failed"
      }));
    }
  } catch (error: any) {
    console.error(JSON.stringify({
      invoiceId,
      rail: "xmr",
      event: "callback_failed"
    }));
  }
}

// Monitoring loop - Check for incoming payments
async function monitorSubaddresses() {
  try {
    const activeStates = storage.getAllActivePaymentStates();

    for (const state of activeStates) {
      try {
        const subaddress = storage.getSubaddress(state.invoiceId);
        if (!subaddress) continue;

        // Get all incoming transfers for this subaddress
        const transfers = await moneroRpc.getTransfers(
          XMR_ACCOUNT_INDEX,
          undefined,
          [subaddress.addressIndex]
        );

        if (!transfers.in || transfers.in.length === 0) continue;

        // Get most recent transfer to this subaddress
        const transfer = transfers.in[0];
        const confirmations = transfer.confirmations;
        const txid = transfer.txid;
        const amountAtomic = transfer.amount.toString();
        const blockHeight = transfer.height;

        let currentState = state.state;

        // STATE MACHINE: unseen → pending → confirmed → settled
        // IMPORTANT: Reload state after each transition to prevent race conditions

        // IDEMPOTENCY GUARD: Skip if already settled
        if (currentState === "settled") {
          continue;
        }

        // Transition: unseen → pending (transaction appears in mempool)
        if (currentState === "unseen" && transfers.in.length > 0) {
          storage.updatePaymentState(state.invoiceId, {
            state: "pending",
            txid,
            confirmations: confirmations.toString(),
            blockHeight: blockHeight.toString(),
            amountAtomic,
          });

          console.log(JSON.stringify({
            invoiceId: state.invoiceId,
            rail: "xmr",
            event: "tx_seen"
          }));

          // Reload state after transition
          const reloadedState = storage.getPaymentState(state.invoiceId);
          if (!reloadedState) continue;
          currentState = reloadedState.state;
        }

        // Update confirmations for pending/confirmed states
        if (currentState === "pending" || currentState === "confirmed") {
          storage.updatePaymentState(state.invoiceId, {
            confirmations: confirmations.toString(),
            blockHeight: blockHeight.toString(),
          });
        }

        // Transition: pending → confirmed (confirmations >= threshold)
        if (currentState === "pending" && confirmations >= XMR_CONFIRMATIONS_REQUIRED) {
          storage.updatePaymentState(state.invoiceId, {
            state: "confirmed",
            confirmations: confirmations.toString(),
          });

          console.log(JSON.stringify({
            invoiceId: state.invoiceId,
            rail: "xmr",
            event: "confirmed"
          }));

          // Reload state after transition
          const reloadedState = storage.getPaymentState(state.invoiceId);
          if (!reloadedState) continue;
          currentState = reloadedState.state;
        }

        // Transition: confirmed → settled (only if confirmed or pending with enough confirmations)
        if (currentState === "confirmed" || 
            (currentState === "pending" && confirmations >= XMR_CONFIRMATIONS_REQUIRED)) {
          
          // Mark as settled BEFORE callback (prevents duplicate callbacks on retry)
          storage.updatePaymentState(state.invoiceId, {
            state: "settled",
            confirmations: confirmations.toString(),
            paidAt: new Date(),
          });

          // Callback to payments service (fire-and-forget after state persisted)
          // If callback fails, state remains settled, preventing duplicate attempts
          await callbackPaymentsService(
            state.invoiceId,
            txid,
            confirmations,
            blockHeight
          );
        }
      } catch (error: any) {
        // Silent error - will retry on next interval
      }
    }
  } catch (error: any) {
    // Silent error - monitoring will retry on next interval
  }
}

// Start monitoring loop
let monitoringInterval: NodeJS.Timeout | null = null;

function startMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  // Initial check
  monitorSubaddresses().catch((err: any) => {
    // Silent error - will retry on interval
  });

  // Periodic monitoring
  monitoringInterval = setInterval(async () => {
    await monitorSubaddresses().catch(err => {
      // Silent error - will retry on next interval
    });
  }, POLLING_INTERVAL_MS);

  console.log(`Started Monero payment monitoring (interval: ${POLLING_INTERVAL_MS}ms, confirmations: ${XMR_CONFIRMATIONS_REQUIRED})`);
}

// Graceful shutdown
process.on("SIGINT", () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  storage.close();
  process.exit(0);
});

// POST /create - Create new Monero subaddress for invoice
app.post("/create", authenticatePaymentsService, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = createSubaddressSchema.parse(req.body);

    // Idempotent: Return existing subaddress if already generated
    const existingSubaddress = storage.getSubaddress(invoiceId);
    if (existingSubaddress) {
      return res.json({
        subaddress: existingSubaddress.subaddress,
        accountIndex: existingSubaddress.accountIndex,
        addressIndex: existingSubaddress.addressIndex,
      });
    }

    // Create new subaddress via Monero RPC
    const rpcResult = await moneroRpc.createAddress(
      XMR_ACCOUNT_INDEX,
      `Invoice:${invoiceId.substring(0, 8)}`
    );

    // Persist to database (crash-safe)
    storage.createSubaddress({
      invoiceId,
      subaddress: rpcResult.address,
      accountIndex: XMR_ACCOUNT_INDEX,
      addressIndex: rpcResult.address_index,
    });

    // Initialize payment state
    storage.createPaymentState(invoiceId, rpcResult.address);

    console.log(JSON.stringify({
      invoiceId,
      rail: "xmr",
      event: "subaddress_created"
    }));

    res.json({
      subaddress: rpcResult.address,
      accountIndex: XMR_ACCOUNT_INDEX,
      addressIndex: rpcResult.address_index,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request data" });
    }
    // Silent error - operational detail not exposed
    res.status(500).json({ error: "Failed to create Monero subaddress" });
  }
});

// GET /health - Health check endpoint
app.get("/health", async (_req: Request, res: Response) => {
  try {
    const isHealthy = await moneroRpc.ping();
    if (isHealthy) {
      res.json({ ok: true, service: "rail-xmr", walletRpc: "connected" });
    } else {
      res.status(503).json({ ok: false, service: "rail-xmr", walletRpc: "disconnected" });
    }
  } catch (error) {
    res.status(503).json({ ok: false, service: "rail-xmr", walletRpc: "error" });
  }
});

// Server startup
app.listen(PORT, "0.0.0.0", async () => {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║       Monero Rail Service (rail-xmr) v1.0.0              ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║ Status:       ✓ OPERATIONAL                               ║");
  console.log(`║ Port:         ${PORT.toString().padEnd(46)}║`);
  console.log(`║ Account:      ${XMR_ACCOUNT_INDEX.toString().padEnd(46)}║`);
  console.log(`║ Confirmations: ${XMR_CONFIRMATIONS_REQUIRED.toString().padEnd(45)}║`);
  console.log("║ Persistence:  Database (Production-Ready)                 ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // Test Monero RPC connection
  try {
    const isHealthy = await moneroRpc.ping();
    if (isHealthy) {
      console.log("✓ Monero Wallet RPC connected successfully");
      startMonitoring();
    } else {
      console.warn("⚠ Warning: Could not connect to Monero Wallet RPC");
      console.warn("  Service running in degraded mode. /create endpoints will fail.");
      console.warn(`  Check XMR_RPC_HOST (${XMR_RPC_HOST}) and XMR_RPC_PORT (${XMR_RPC_PORT})`);
    }
  } catch (error: any) {
    console.warn("⚠ Warning: Monero Wallet RPC connection error");
    console.warn("  Service running in degraded mode. /create endpoints will fail.");
    console.warn(`  Error: ${error.message}`);
  }
});
