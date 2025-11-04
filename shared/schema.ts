import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  description: text("description").notNull(),
  paymentAddress: text("payment_address").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  expiresAt: timestamp("expires_at"),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  paidAt: true,
  status: true,
}).extend({
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, "Invalid amount format"),
  currency: z.enum(["BTC", "Lightning", "XMR"]),
  description: z.string().min(1, "Description is required"),
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export const webhookLogs = pgTable("webhook_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  url: text("url").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  statusCode: varchar("status_code", { length: 10 }),
  errorMessage: text("error_message"),
  payload: text("payload"),
  responseBody: text("response_body"),
  attempt: varchar("attempt", { length: 10 }).default("1"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
