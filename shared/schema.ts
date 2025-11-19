import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  asset: varchar("asset", { length: 10 }).notNull(),
  description: text("description").notNull(),
  paymentAddress: text("payment_address").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  expiresAt: timestamp("expires_at"),
  amountPaidAtomic: varchar("amount_paid_atomic", { length: 20 }),
  railType: varchar("rail_type", { length: 20 }),
  bolt11Invoice: text("bolt11_invoice"),
  derivedAddress: text("derived_address"),
  subaddress: text("subaddress"),
  paymentSource: varchar("payment_source", { length: 20 }),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  paidAt: true,
  status: true,
}).extend({
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, "Invalid amount format"),
  currency: z.enum(["BTC", "Lightning", "XMR"]),
  asset: z.enum(["BTC", "XMR"]),
  description: z.string().min(1, "Description is required"),
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export const webhookLogs = pgTable("webhook_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  url: text("url").notNull(),
  status: varchar("status", { length: 20 }).notNull(), // pending, success, failed
  statusCode: varchar("status_code", { length: 10 }),
  errorMessage: text("error_message"),
  attempt: varchar("attempt", { length: 10 }).default("1"),
  retryAfter: timestamp("retry_after"), // When to retry next (for persistent queue)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at"),
});

export type WebhookLog = typeof webhookLogs.$inferSelect;

export const paymentTransactions = pgTable("payment_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  transactionId: text("transaction_id").notNull(),
  confirmations: varchar("confirmations", { length: 10 }).notNull(),
  blockHeight: varchar("block_height", { length: 20 }),
  confirmedAt: timestamp("confirmed_at").notNull().defaultNow(),
});

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;

export const templates = pgTable("templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planName: text("plan_name").notNull(),
  asset: varchar("asset", { length: 10 }).notNull(),
  amountUsd: text("amount_usd"),
  interval: varchar("interval", { length: 20 }),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTemplateSchema = createInsertSchema(templates).omit({
  id: true,
  createdAt: true,
}).extend({
  planName: z.string().min(1, "Plan name is required"),
  asset: z.enum(["BTC", "Lightning", "XMR"]),
  amountUsd: z.string().regex(/^\d+(\.\d{1,8})?$/, "Invalid amount format").optional(),
  interval: z.enum(["one-time", "monthly", "yearly"]).optional(),
});

export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;

export const paymentConfirmationSchema = z.object({
  invoiceId: z.string().uuid(),
  transactionId: z.string().min(1),
  confirmations: z.number().int().nonnegative(),
  blockHeight: z.number().int().positive().optional(),
});

// Bitcoin address derivations - persistent tracking of derived addresses
export const btcAddressDerivations = pgTable("btc_address_derivations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().unique(),
  address: text("address").notNull(),
  derivationIndex: varchar("derivation_index", { length: 20 }).notNull(),
  derivationPath: text("derivation_path").notNull(),
  amountSats: varchar("amount_sats", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BtcAddressDerivation = typeof btcAddressDerivations.$inferSelect;
export type InsertBtcAddressDerivation = {
  invoiceId: string;
  address: string;
  derivationIndex: number;
  derivationPath: string;
  amountSats: number;
};

// Bitcoin payment states - state machine tracking for payment confirmations
export const btcPaymentStates = pgTable("btc_payment_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().unique(),
  address: text("address").notNull(),
  state: varchar("state", { length: 20 }).notNull(), // unseen, pending, confirmed, settled
  txid: text("txid"),
  confirmations: varchar("confirmations", { length: 10 }).default("0"),
  blockHeight: varchar("block_height", { length: 20 }),
  amountSats: varchar("amount_sats", { length: 20 }),
  lastChecked: timestamp("last_checked"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BtcPaymentState = typeof btcPaymentStates.$inferSelect;
export type InsertBtcPaymentState = {
  invoiceId: string;
  address: string;
  state: "unseen" | "pending" | "confirmed" | "settled";
  txid?: string;
  confirmations?: number;
  blockHeight?: number;
  amountSats?: number;
};
