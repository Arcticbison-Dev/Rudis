import Database from "better-sqlite3";
import { randomBytes } from "crypto";

// Database schema for XMR subaddress tracking
export interface XmrSubaddress {
  id: string;
  invoiceId: string;
  subaddress: string;
  accountIndex: number;
  addressIndex: number;
  createdAt: Date;
}

export interface XmrPaymentState {
  id: string;
  invoiceId: string;
  subaddress: string;
  state: "unseen" | "pending" | "confirmed" | "settled";
  txid: string | null;
  confirmations: string;
  blockHeight: string | null;
  amountAtomic: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubaddressInput {
  invoiceId: string;
  subaddress: string;
  accountIndex: number;
  addressIndex: number;
}

export interface UpdatePaymentStateInput {
  state?: "unseen" | "pending" | "confirmed" | "settled";
  txid?: string | null;
  confirmations?: string;
  blockHeight?: string | null;
  amountAtomic?: string | null;
  paidAt?: Date | null;
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_xmr_invoice_id ON xmr_subaddresses(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_xmr_address_index ON xmr_subaddresses(address_index);
    `);

    // Payment state tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS xmr_payment_states (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL UNIQUE,
        subaddress TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('unseen', 'pending', 'confirmed', 'settled')),
        txid TEXT,
        confirmations TEXT NOT NULL DEFAULT '0',
        block_height TEXT,
        amount_atomic TEXT,
        paid_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_xmr_payment_invoice ON xmr_payment_states(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_xmr_payment_state ON xmr_payment_states(state);
    `);

    // Subaddress index counter (atomic increment)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS xmr_subaddress_counter (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        next_index INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO xmr_subaddress_counter (id, next_index) VALUES (1, 0);
    `);
  }

  // Get next subaddress index (atomic)
  getNextSubaddressIndex(): number {
    const stmt = this.db.prepare(`
      UPDATE xmr_subaddress_counter 
      SET next_index = next_index + 1 
      WHERE id = 1
      RETURNING next_index
    `);
    const result = stmt.get() as { next_index: number };
    return result.next_index;
  }

  // Save subaddress derivation
  createSubaddress(input: CreateSubaddressInput): XmrSubaddress {
    const id = randomBytes(16).toString("hex");
    const stmt = this.db.prepare(`
      INSERT INTO xmr_subaddresses (id, invoice_id, subaddress, account_index, address_index)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, input.invoiceId, input.subaddress, input.accountIndex, input.addressIndex);

    const result = this.getSubaddress(input.invoiceId);
    if (!result) {
      throw new Error("Failed to create subaddress");
    }
    return result;
  }

  // Get subaddress by invoice ID
  getSubaddress(invoiceId: string): XmrSubaddress | null {
    const stmt = this.db.prepare(`
      SELECT id, invoice_id, subaddress, account_index, address_index, created_at
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
      txid: row.txid,
      confirmations: row.confirmations,
      blockHeight: row.block_height,
      amountAtomic: row.amount_atomic,
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
    if (updates.txid !== undefined) {
      fields.push("txid = ?");
      values.push(updates.txid);
    }
    if (updates.confirmations !== undefined) {
      fields.push("confirmations = ?");
      values.push(updates.confirmations);
    }
    if (updates.blockHeight !== undefined) {
      fields.push("block_height = ?");
      values.push(updates.blockHeight);
    }
    if (updates.amountAtomic !== undefined) {
      fields.push("amount_atomic = ?");
      values.push(updates.amountAtomic);
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
      WHERE state IN ('unseen', 'pending', 'confirmed')
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      id: row.id,
      invoiceId: row.invoice_id,
      subaddress: row.subaddress,
      state: row.state,
      txid: row.txid,
      confirmations: row.confirmations,
      blockHeight: row.block_height,
      amountAtomic: row.amount_atomic,
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
