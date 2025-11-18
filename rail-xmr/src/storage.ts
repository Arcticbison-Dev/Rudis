import Database from "better-sqlite3";
import { randomBytes, createHash } from "crypto";

// PRIVACY-FIRST: XMR rail stores HASHED txids, not raw blockchain data
// This aligns with Monero's privacy philosophy

export interface XmrSubaddress {
  id: string;
  invoiceId: string;
  subaddress: string;
  accountIndex: number;
  addressIndex: number;
  expectedAmountAtomic: string; // Expected payment amount in atomic units
  createdAt: Date;
}

export interface XmrPaymentState {
  id: string;
  invoiceId: string;
  subaddress: string;
  state: "unseen" | "pending" | "confirmed" | "callback_pending" | "settled";
  hashedTxid: string | null;  // SHA-256 hash, NOT raw txid
  amountMatch: boolean | null; // Boolean flag, NOT raw amount
  confirmations: string;
  blockHeight: string | null;
  callbackAttempts: number;
  lastCallbackAttempt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubaddressInput {
  invoiceId: string;
  subaddress: string;
  accountIndex: number;
  addressIndex: number;
  expectedAmountAtomic: string;
}

export interface UpdatePaymentStateInput {
  state?: "unseen" | "pending" | "confirmed" | "callback_pending" | "settled";
  hashedTxid?: string | null;
  amountMatch?: boolean | null;
  confirmations?: string;
  blockHeight?: string | null;
  callbackAttempts?: number;
  lastCallbackAttempt?: Date | null;
  paidAt?: Date | null;
}

// Privacy helper: Hash transaction ID before storage
export function hashTxid(txid: string): string {
  return createHash("sha256")
    .update(txid)
    .update("monero-privacy-salt") // Static salt for deterministic hashing
    .digest("hex")
    .substring(0, 32); // First 32 chars for storage efficiency
}

export class XmrStorage {
  private db: Database.Database;

  constructor(dbPath: string = "./xmr_rail.db") {
    this.db = new Database(dbPath);
    this.initializeTables();
  }

  private initializeTables(): void {
    // Subaddress tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS xmr_subaddresses (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL UNIQUE,
        subaddress TEXT NOT NULL,
        account_index INTEGER NOT NULL,
        address_index INTEGER NOT NULL,
        expected_amount_atomic TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_xmr_invoice_id ON xmr_subaddresses(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_xmr_address_index ON xmr_subaddresses(address_index);
    `);

    // Payment state tracking table (PRIVACY-FIRST: hashed txids only)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS xmr_payment_states (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL UNIQUE,
        subaddress TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('unseen', 'pending', 'confirmed', 'callback_pending', 'settled')),
        hashed_txid TEXT,
        amount_match INTEGER,
        confirmations TEXT NOT NULL DEFAULT '0',
        block_height TEXT,
        callback_attempts INTEGER NOT NULL DEFAULT 0,
        last_callback_attempt DATETIME,
        paid_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_xmr_payment_invoice ON xmr_payment_states(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_xmr_payment_state ON xmr_payment_states(state);
    `);
  }

  // Save subaddress derivation
  createSubaddress(input: CreateSubaddressInput): XmrSubaddress {
    const id = randomBytes(16).toString("hex");
    const stmt = this.db.prepare(`
      INSERT INTO xmr_subaddresses (id, invoice_id, subaddress, account_index, address_index, expected_amount_atomic)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, input.invoiceId, input.subaddress, input.accountIndex, input.addressIndex, input.expectedAmountAtomic);

    const result = this.getSubaddress(input.invoiceId);
    if (!result) {
      throw new Error("Failed to create subaddress");
    }
    return result;
  }

  // Get subaddress by invoice ID
  getSubaddress(invoiceId: string): XmrSubaddress | null {
    const stmt = this.db.prepare(`
      SELECT id, invoice_id, subaddress, account_index, address_index, expected_amount_atomic, created_at
      FROM xmr_subaddresses
      WHERE invoice_id = ?
    `);
    const row = stmt.get(invoiceId) as any;
    if (!row) return null;

    return {
      id: row.id,
      invoiceId: row.invoice_id,
      subaddress: row.subaddress,
      accountIndex: row.account_index,
      addressIndex: row.address_index,
      expectedAmountAtomic: row.expected_amount_atomic,
      createdAt: new Date(row.created_at),
    };
  }

  // Create payment state
  createPaymentState(invoiceId: string, subaddress: string): XmrPaymentState {
    const id = randomBytes(16).toString("hex");
    const stmt = this.db.prepare(`
      INSERT INTO xmr_payment_states (id, invoice_id, subaddress, state, confirmations)
      VALUES (?, ?, ?, 'unseen', '0')
    `);
    stmt.run(id, invoiceId, subaddress);

    const result = this.getPaymentState(invoiceId);
    if (!result) {
      throw new Error("Failed to create payment state");
    }
    return result;
  }

  // Get payment state
  getPaymentState(invoiceId: string): XmrPaymentState | null {
    const stmt = this.db.prepare(`
      SELECT * FROM xmr_payment_states WHERE invoice_id = ?
    `);
    const row = stmt.get(invoiceId) as any;
    if (!row) return null;

    return {
      id: row.id,
      invoiceId: row.invoice_id,
      subaddress: row.subaddress,
      state: row.state,
      hashedTxid: row.hashed_txid,
      amountMatch: row.amount_match === null ? null : Boolean(row.amount_match),
      confirmations: row.confirmations,
      blockHeight: row.block_height,
      callbackAttempts: row.callback_attempts,
      lastCallbackAttempt: row.last_callback_attempt ? new Date(row.last_callback_attempt) : null,
      paidAt: row.paid_at ? new Date(row.paid_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // Update payment state
  updatePaymentState(invoiceId: string, updates: UpdatePaymentStateInput): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.state !== undefined) {
      fields.push("state = ?");
      values.push(updates.state);
    }
    if (updates.hashedTxid !== undefined) {
      fields.push("hashed_txid = ?");
      values.push(updates.hashedTxid);
    }
    if (updates.amountMatch !== undefined) {
      fields.push("amount_match = ?");
      values.push(updates.amountMatch === null ? null : (updates.amountMatch ? 1 : 0));
    }
    if (updates.confirmations !== undefined) {
      fields.push("confirmations = ?");
      values.push(updates.confirmations);
    }
    if (updates.blockHeight !== undefined) {
      fields.push("block_height = ?");
      values.push(updates.blockHeight);
    }
    if (updates.callbackAttempts !== undefined) {
      fields.push("callback_attempts = ?");
      values.push(updates.callbackAttempts);
    }
    if (updates.lastCallbackAttempt !== undefined) {
      fields.push("last_callback_attempt = ?");
      values.push(updates.lastCallbackAttempt ? updates.lastCallbackAttempt.toISOString() : null);
    }
    if (updates.paidAt !== undefined) {
      fields.push("paid_at = ?");
      values.push(updates.paidAt ? updates.paidAt.toISOString() : null);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");

    if (fields.length > 0) {
      const stmt = this.db.prepare(`
        UPDATE xmr_payment_states 
        SET ${fields.join(", ")} 
        WHERE invoice_id = ?
      `);
      values.push(invoiceId);
      stmt.run(...values);
    }
  }

  // Get all active payment states (for monitoring)
  getAllActivePaymentStates(): XmrPaymentState[] {
    const stmt = this.db.prepare(`
      SELECT * FROM xmr_payment_states 
      WHERE state IN ('unseen', 'pending', 'confirmed', 'callback_pending')
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      id: row.id,
      invoiceId: row.invoice_id,
      subaddress: row.subaddress,
      state: row.state,
      hashedTxid: row.hashed_txid,
      amountMatch: row.amount_match === null ? null : Boolean(row.amount_match),
      confirmations: row.confirmations,
      blockHeight: row.block_height,
      callbackAttempts: row.callback_attempts,
      lastCallbackAttempt: row.last_callback_attempt ? new Date(row.last_callback_attempt) : null,
      paidAt: row.paid_at ? new Date(row.paid_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  // Close database connection
  close(): void {
    this.db.close();
  }
}
