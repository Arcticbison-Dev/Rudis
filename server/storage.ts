import { 
  type Invoice, 
  type InsertInvoice, 
  type WebhookLog, 
  type PaymentTransaction, 
  type Template, 
  type InsertTemplate,
  type BtcAddressDerivation,
  type InsertBtcAddressDerivation,
  type BtcPaymentState,
  type InsertBtcPaymentState,
  invoices,
  webhookLogs,
  paymentTransactions,
  templates,
  btcAddressDerivations,
  btcPaymentStates,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { db } from "./db";
import { eq, lt, and, max, sql as drizzleSql } from "drizzle-orm";

export interface IStorage {
  // Invoice operations
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  getInvoiceByCheckingId(checkingId: string): Promise<Invoice | undefined>;
  getAllInvoices(): Promise<Invoice[]>;
  getPendingLightningInvoices(limit?: number): Promise<Invoice[]>;
  updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice | undefined>;
  updateInvoiceStatus(id: string, status: string, paidAt?: Date): Promise<Invoice | undefined>;
  checkAndExpireInvoices(): Promise<number>;
  purgeExpiredInvoices(daysOld?: number): Promise<number>;
  
  // Payment transaction operations
  createPaymentTransaction(tx: {
    invoiceId: string;
    rail?: string;
    transactionId: string;
    confirmations: number;
    blockHeight?: number;
  }): Promise<PaymentTransaction>;
  getPaymentTransactionsByInvoice(invoiceId: string): Promise<PaymentTransaction[]>;
  
  // Webhook log operations
  createWebhookLog(log: {
    invoiceId: string;
    url: string;
    status: string;
    statusCode?: number;
    errorMessage?: string;
    attempt?: number;
    retryAfter?: Date | null;
  }): Promise<WebhookLog>;
  updateWebhookLog(id: string, updates: {
    status?: string;
    statusCode?: number;
    errorMessage?: string;
    attempt?: number;
    retryAfter?: Date | null;
    lastAttemptAt?: Date;
  }): Promise<WebhookLog | undefined>;
  getWebhookLogsByInvoice(invoiceId: string): Promise<WebhookLog[]>;
  getPendingWebhooks(): Promise<WebhookLog[]>;
  deleteOldFailedWebhooks(cutoffDate: Date, maxAttempts: number): Promise<number>;
  
  // Template operations
  createTemplate(template: InsertTemplate): Promise<Template>;
  getTemplate(id: string): Promise<Template | undefined>;
  getAllTemplates(): Promise<Template[]>;
  updateTemplate(id: string, template: Partial<InsertTemplate>): Promise<Template | undefined>;
  deleteTemplate(id: string): Promise<boolean>;
  
  // Bitcoin address derivation operations (production-ready persistence)
  getNextDerivationIndex(): Promise<number>;
  createBtcAddressDerivation(derivation: InsertBtcAddressDerivation): Promise<BtcAddressDerivation>;
  getBtcAddressDerivation(invoiceId: string): Promise<BtcAddressDerivation | undefined>;
  
  // Bitcoin payment state operations (production-ready state machine)
  createBtcPaymentState(state: InsertBtcPaymentState): Promise<BtcPaymentState>;
  getBtcPaymentState(invoiceId: string): Promise<BtcPaymentState | undefined>;
  updateBtcPaymentState(invoiceId: string, updates: Partial<BtcPaymentState>): Promise<BtcPaymentState | undefined>;
  getAllActiveBtcPaymentStates(): Promise<BtcPaymentState[]>;
}

export class MemStorage implements IStorage {
  private invoices: Map<string, Invoice>;
  private webhookLogs: Map<string, WebhookLog>;
  private paymentTransactions: Map<string, PaymentTransaction>;
  private templates: Map<string, Template>;
  private readonly templatesFile = "templates.json";

  constructor() {
    this.invoices = new Map();
    this.webhookLogs = new Map();
    this.paymentTransactions = new Map();
    this.templates = new Map();
    this.loadTemplatesFromFile().catch(err => 
      console.error("Failed to load templates:", err)
    );
  }

  private async loadTemplatesFromFile(): Promise<void> {
    try {
      if (existsSync(this.templatesFile)) {
        const data = await readFile(this.templatesFile, "utf-8");
        const templates: Template[] = JSON.parse(data);
        for (const template of templates) {
          this.templates.set(template.id, {
            ...template,
            createdAt: new Date(template.createdAt),
          });
        }
        console.log(`✓ Loaded ${templates.length} template(s) from ${this.templatesFile}`);
      }
    } catch (error) {
      console.error(`Error loading templates from ${this.templatesFile}:`, error);
    }
  }

  private async saveTemplatesToFile(): Promise<void> {
    try {
      const templates = Array.from(this.templates.values());
      await writeFile(this.templatesFile, JSON.stringify(templates, null, 2), "utf-8");
    } catch (error) {
      console.error(`Error saving templates to ${this.templatesFile}:`, error);
    }
  }

  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const id = randomUUID();
    const now = new Date();
    
    const invoice: Invoice = {
      id,
      amount: insertInvoice.amount,
      currency: insertInvoice.currency,
      asset: insertInvoice.asset,
      description: insertInvoice.description,
      paymentAddress: insertInvoice.paymentAddress,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      expiresAt: insertInvoice.expiresAt ? new Date(insertInvoice.expiresAt) : null,
      amountPaidAtomic: null,
      railType: (insertInvoice as any).railType || null,
      bolt11Invoice: (insertInvoice as any).bolt11Invoice || null,
      derivedAddress: (insertInvoice as any).derivedAddress || null,
      subaddress: (insertInvoice as any).subaddress || null,
      paymentSource: (insertInvoice as any).paymentSource || null,
      lnPaymentHash: (insertInvoice as any).lnPaymentHash || null,
      lnCheckingId: (insertInvoice as any).lnCheckingId || null,
    };
    
    this.invoices.set(id, invoice);
    return invoice;
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }

  async getInvoiceByCheckingId(checkingId: string): Promise<Invoice | undefined> {
    return Array.from(this.invoices.values()).find(inv => inv.lnCheckingId === checkingId);
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return Array.from(this.invoices.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getPendingLightningInvoices(limit: number = 100): Promise<Invoice[]> {
    return Array.from(this.invoices.values())
      .filter((inv) => inv.currency === "Lightning" && inv.status === "pending" && inv.lnPaymentHash)
      .slice(0, limit);
  }

  async updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice | undefined> {
    const invoice = this.invoices.get(id);
    if (!invoice) return undefined;

    const updatedInvoice: Invoice = {
      ...invoice,
      ...updates,
      id: invoice.id, // Prevent ID from being updated
      createdAt: invoice.createdAt, // Prevent createdAt from being updated
    };

    this.invoices.set(id, updatedInvoice);
    return updatedInvoice;
  }

  async updateInvoiceStatus(
    id: string,
    status: string,
    paidAt?: Date
  ): Promise<Invoice | undefined> {
    const invoice = this.invoices.get(id);
    if (!invoice) return undefined;

    const updatedInvoice: Invoice = {
      ...invoice,
      status,
      updatedAt: new Date(),
      paidAt: paidAt || invoice.paidAt,
    };

    this.invoices.set(id, updatedInvoice);
    return updatedInvoice;
  }

  async createPaymentTransaction(tx: {
    invoiceId: string;
    rail?: string;
    transactionId: string;
    confirmations: number;
    blockHeight?: number;
  }): Promise<PaymentTransaction> {
    const id = randomUUID();
    const transaction: PaymentTransaction = {
      id,
      invoiceId: tx.invoiceId,
      rail: tx.rail || null,
      transactionId: tx.transactionId,
      confirmations: tx.confirmations.toString(),
      blockHeight: tx.blockHeight?.toString() || null,
      confirmedAt: new Date(),
    };

    this.paymentTransactions.set(id, transaction);
    return transaction;
  }

  async getPaymentTransactionsByInvoice(invoiceId: string): Promise<PaymentTransaction[]> {
    return Array.from(this.paymentTransactions.values())
      .filter((tx) => tx.invoiceId === invoiceId)
      .sort(
        (a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()
      );
  }

  async createWebhookLog(log: {
    invoiceId: string;
    url: string;
    status: string;
    statusCode?: number;
    errorMessage?: string;
    attempt?: number;
    retryAfter?: Date | null;
  }): Promise<WebhookLog> {
    const id = randomUUID();
    const webhookLog: WebhookLog = {
      id,
      invoiceId: log.invoiceId,
      url: log.url,
      status: log.status,
      statusCode: log.statusCode?.toString() || null,
      errorMessage: log.errorMessage || null,
      attempt: log.attempt?.toString() || "1",
      retryAfter: log.retryAfter || null,
      createdAt: new Date(),
      lastAttemptAt: null,
    };

    this.webhookLogs.set(id, webhookLog);
    return webhookLog;
  }

  async updateWebhookLog(id: string, updates: {
    status?: string;
    statusCode?: number;
    errorMessage?: string;
    attempt?: number;
    retryAfter?: Date | null;
    lastAttemptAt?: Date;
  }): Promise<WebhookLog | undefined> {
    const log = this.webhookLogs.get(id);
    if (!log) return undefined;

    const updatedLog: WebhookLog = {
      ...log,
      ...(updates.status && { status: updates.status }),
      ...(updates.statusCode && { statusCode: updates.statusCode.toString() }),
      ...(updates.errorMessage !== undefined && { errorMessage: updates.errorMessage }),
      ...(updates.attempt !== undefined && { attempt: updates.attempt.toString() }),
      ...(updates.retryAfter !== undefined && { retryAfter: updates.retryAfter }),
      ...(updates.lastAttemptAt && { lastAttemptAt: updates.lastAttemptAt }),
    };

    this.webhookLogs.set(id, updatedLog);
    return updatedLog;
  }

  async getWebhookLogsByInvoice(invoiceId: string): Promise<WebhookLog[]> {
    return Array.from(this.webhookLogs.values())
      .filter((log) => log.invoiceId === invoiceId)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async getPendingWebhooks(): Promise<WebhookLog[]> {
    return Array.from(this.webhookLogs.values())
      .filter((log) => log.status === "pending");
  }

  async deleteOldFailedWebhooks(cutoffDate: Date, maxAttempts: number): Promise<number> {
    let deletedCount = 0;
    const logsToDelete = Array.from(this.webhookLogs.entries()).filter(([id, log]) => {
      const isFailed = log.status === "failed";
      const isOld = log.lastAttemptAt && new Date(log.lastAttemptAt) < cutoffDate;
      const exceededAttempts = parseInt(log.attempt || "1", 10) >= maxAttempts;
      return isFailed && (isOld || exceededAttempts);
    });

    for (const [id] of logsToDelete) {
      this.webhookLogs.delete(id);
      deletedCount++;
    }

    return deletedCount;
  }

  async checkAndExpireInvoices(): Promise<number> {
    const now = new Date();
    let expiredCount = 0;

    const invoiceEntries = Array.from(this.invoices.entries());
    for (const [id, invoice] of invoiceEntries) {
      if (
        invoice.status === "pending" &&
        invoice.expiresAt &&
        new Date(invoice.expiresAt) <= now
      ) {
        const updatedInvoice: Invoice = {
          ...invoice,
          status: "expired",
        };
        this.invoices.set(id, updatedInvoice);
        expiredCount++;
      }
    }

    return expiredCount;
  }

  async createTemplate(insertTemplate: InsertTemplate): Promise<Template> {
    const id = randomUUID();
    const now = new Date();
    
    const template: Template = {
      id,
      planName: insertTemplate.planName,
      asset: insertTemplate.asset,
      amountUsd: (insertTemplate.amountUsd && insertTemplate.amountUsd.trim() !== "") ? insertTemplate.amountUsd : null,
      interval: insertTemplate.interval || null,
      description: insertTemplate.description || null,
      createdAt: now,
    };
    
    this.templates.set(id, template);
    await this.saveTemplatesToFile();
    console.log(`✓ Template created and saved: ${template.id} - ${template.planName}`);
    return template;
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    return this.templates.get(id);
  }

  async getAllTemplates(): Promise<Template[]> {
    return Array.from(this.templates.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async updateTemplate(id: string, updates: Partial<InsertTemplate>): Promise<Template | undefined> {
    const template = this.templates.get(id);
    if (!template) return undefined;

    const sanitizedUpdates: Partial<Template> = {
      ...updates,
      ...(updates.amountUsd !== undefined && { amountUsd: (updates.amountUsd && updates.amountUsd.trim() !== "") ? updates.amountUsd : null }),
      ...(updates.interval !== undefined && { interval: updates.interval || null }),
    };

    const updatedTemplate: Template = {
      ...template,
      ...sanitizedUpdates,
    };

    this.templates.set(id, updatedTemplate);
    await this.saveTemplatesToFile();
    console.log(`✓ Template updated and saved: ${updatedTemplate.id} - ${updatedTemplate.planName}`);
    return updatedTemplate;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const deleted = this.templates.delete(id);
    if (deleted) {
      await this.saveTemplatesToFile();
      console.log(`✓ Template deleted and file updated: ${id}`);
    }
    return deleted;
  }

  async purgeExpiredInvoices(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    let purgedCount = 0;

    const invoicesToPurge = Array.from(this.invoices.entries()).filter(([id, invoice]) => 
      invoice.status === "expired" &&
      invoice.expiresAt &&
      new Date(invoice.expiresAt) < cutoffDate
    );

    for (const [id, invoice] of invoicesToPurge) {
      // Delete related webhook logs
      const logsToDelete = Array.from(this.webhookLogs.entries())
        .filter(([logId, log]) => log.invoiceId === id)
        .map(([logId]) => logId);
      
      for (const logId of logsToDelete) {
        this.webhookLogs.delete(logId);
      }

      // Delete related payment transactions (if any exist for expired invoices)
      const txsToDelete = Array.from(this.paymentTransactions.entries())
        .filter(([txId, tx]) => tx.invoiceId === id)
        .map(([txId]) => txId);
      
      for (const txId of txsToDelete) {
        this.paymentTransactions.delete(txId);
      }

      // Delete the invoice
      this.invoices.delete(id);
      purgedCount++;
    }

    return purgedCount;
  }

  // Bitcoin operations (not implemented for MemStorage - use DatabaseStorage for production)
  async getNextDerivationIndex(): Promise<number> {
    throw new Error("Bitcoin operations require DatabaseStorage. Use DatabaseStorage for production.");
  }

  async createBtcAddressDerivation(derivation: InsertBtcAddressDerivation): Promise<BtcAddressDerivation> {
    throw new Error("Bitcoin operations require DatabaseStorage. Use DatabaseStorage for production.");
  }

  async getBtcAddressDerivation(invoiceId: string): Promise<BtcAddressDerivation | undefined> {
    throw new Error("Bitcoin operations require DatabaseStorage. Use DatabaseStorage for production.");
  }

  async createBtcPaymentState(state: InsertBtcPaymentState): Promise<BtcPaymentState> {
    throw new Error("Bitcoin operations require DatabaseStorage. Use DatabaseStorage for production.");
  }

  async getBtcPaymentState(invoiceId: string): Promise<BtcPaymentState | undefined> {
    throw new Error("Bitcoin operations require DatabaseStorage. Use DatabaseStorage for production.");
  }

  async updateBtcPaymentState(invoiceId: string, updates: Partial<BtcPaymentState>): Promise<BtcPaymentState | undefined> {
    throw new Error("Bitcoin operations require DatabaseStorage. Use DatabaseStorage for production.");
  }

  async getAllActiveBtcPaymentStates(): Promise<BtcPaymentState[]> {
    throw new Error("Bitcoin operations require DatabaseStorage. Use DatabaseStorage for production.");
  }
}

// DatabaseStorage implementation for production-ready persistence
export class DatabaseStorage implements IStorage {
  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db
      .insert(invoices)
      .values({
        amount: insertInvoice.amount,
        currency: insertInvoice.currency,
        asset: insertInvoice.asset,
        description: insertInvoice.description,
        paymentAddress: insertInvoice.paymentAddress,
        expiresAt: insertInvoice.expiresAt ? new Date(insertInvoice.expiresAt) : null,
        railType: (insertInvoice as any).railType || null,
        bolt11Invoice: (insertInvoice as any).bolt11Invoice || null,
        derivedAddress: (insertInvoice as any).derivedAddress || null,
        subaddress: (insertInvoice as any).subaddress || null,
        paymentSource: (insertInvoice as any).paymentSource || null,
        lnPaymentHash: (insertInvoice as any).lnPaymentHash || null,
        lnCheckingId: (insertInvoice as any).lnCheckingId || null,
        status: "pending",
      })
      .returning();
    return invoice;
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async getInvoiceByCheckingId(checkingId: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.lnCheckingId, checkingId));
    return invoice || undefined;
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return await db.select().from(invoices);
  }

  async getPendingLightningInvoices(limit: number = 100): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.currency, "Lightning"),
          eq(invoices.status, "pending")
        )
      )
      .limit(limit);
  }

  async updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice | undefined> {
    const [updated] = await db
      .update(invoices)
      .set(updates)
      .where(eq(invoices.id, id))
      .returning();
    return updated || undefined;
  }

  async updateInvoiceStatus(id: string, status: string, paidAt?: Date): Promise<Invoice | undefined> {
    const [updated] = await db
      .update(invoices)
      .set({ status, paidAt: paidAt || null })
      .where(eq(invoices.id, id))
      .returning();
    return updated || undefined;
  }

  async checkAndExpireInvoices(): Promise<number> {
    const now = new Date();
    const result = await db
      .update(invoices)
      .set({ status: "expired" })
      .where(
        and(
          eq(invoices.status, "pending"),
          lt(invoices.expiresAt, now)
        )
      )
      .returning();
    return result.length;
  }

  async purgeExpiredInvoices(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(invoices)
      .where(
        and(
          eq(invoices.status, "expired"),
          lt(invoices.expiresAt, cutoffDate)
        )
      )
      .returning();
    return result.length;
  }

  async createPaymentTransaction(tx: {
    invoiceId: string;
    rail?: string;
    transactionId: string;
    confirmations: number;
    blockHeight?: number;
  }): Promise<PaymentTransaction> {
    const [transaction] = await db
      .insert(paymentTransactions)
      .values({
        invoiceId: tx.invoiceId,
        rail: tx.rail || null,
        transactionId: tx.transactionId,
        confirmations: tx.confirmations.toString(),
        blockHeight: tx.blockHeight?.toString() || null,
      })
      .returning();
    return transaction;
  }

  async getPaymentTransactionsByInvoice(invoiceId: string): Promise<PaymentTransaction[]> {
    return await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.invoiceId, invoiceId));
  }

  async createWebhookLog(log: {
    invoiceId: string;
    url: string;
    status: string;
    statusCode?: number;
    errorMessage?: string;
    attempt?: number;
    retryAfter?: Date | null;
  }): Promise<WebhookLog> {
    const [webhookLog] = await db
      .insert(webhookLogs)
      .values({
        invoiceId: log.invoiceId,
        url: log.url,
        status: log.status,
        statusCode: log.statusCode?.toString() || null,
        errorMessage: log.errorMessage || null,
        attempt: log.attempt?.toString() || "1",
        retryAfter: log.retryAfter || null,
      })
      .returning();
    return webhookLog;
  }

  async updateWebhookLog(id: string, updates: {
    status?: string;
    statusCode?: number;
    errorMessage?: string;
    attempt?: number;
    retryAfter?: Date | null;
    lastAttemptAt?: Date;
  }): Promise<WebhookLog | undefined> {
    const [updated] = await db
      .update(webhookLogs)
      .set({
        ...updates,
        statusCode: updates.statusCode?.toString(),
        attempt: updates.attempt?.toString(),
      })
      .where(eq(webhookLogs.id, id))
      .returning();
    return updated || undefined;
  }

  async getWebhookLogsByInvoice(invoiceId: string): Promise<WebhookLog[]> {
    return await db
      .select()
      .from(webhookLogs)
      .where(eq(webhookLogs.invoiceId, invoiceId));
  }

  async getPendingWebhooks(): Promise<WebhookLog[]> {
    const now = new Date();
    return await db
      .select()
      .from(webhookLogs)
      .where(
        and(
          eq(webhookLogs.status, "pending"),
          lt(webhookLogs.retryAfter, now)
        )
      );
  }

  async deleteOldFailedWebhooks(cutoffDate: Date, maxAttempts: number): Promise<number> {
    const result = await db
      .delete(webhookLogs)
      .where(
        and(
          eq(webhookLogs.status, "failed"),
          lt(webhookLogs.lastAttemptAt, cutoffDate)
        )
      )
      .returning();
    return result.length;
  }

  async createTemplate(template: InsertTemplate): Promise<Template> {
    const [created] = await db
      .insert(templates)
      .values({
        planName: template.planName,
        asset: template.asset,
        amountUsd: template.amountUsd || null,
        interval: template.interval || null,
        description: template.description || null,
      })
      .returning();
    return created;
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    const [template] = await db.select().from(templates).where(eq(templates.id, id));
    return template || undefined;
  }

  async getAllTemplates(): Promise<Template[]> {
    return await db.select().from(templates);
  }

  async updateTemplate(id: string, template: Partial<InsertTemplate>): Promise<Template | undefined> {
    const [updated] = await db
      .update(templates)
      .set({
        ...template,
        amountUsd: template.amountUsd || null,
        interval: template.interval || null,
      })
      .where(eq(templates.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const result = await db
      .delete(templates)
      .where(eq(templates.id, id))
      .returning();
    return result.length > 0;
  }

  // Bitcoin address derivation operations - production-ready persistence
  async getNextDerivationIndex(): Promise<number> {
    const result = await db
      .select({ maxIndex: max(btcAddressDerivations.derivationIndex) })
      .from(btcAddressDerivations);
    
    const maxIndex = result[0]?.maxIndex;
    return maxIndex ? parseInt(maxIndex) + 1 : 0;
  }

  async createBtcAddressDerivation(derivation: InsertBtcAddressDerivation): Promise<BtcAddressDerivation> {
    const [created] = await db
      .insert(btcAddressDerivations)
      .values({
        invoiceId: derivation.invoiceId,
        address: derivation.address,
        derivationIndex: derivation.derivationIndex.toString(),
        derivationPath: derivation.derivationPath,
        amountSats: derivation.amountSats.toString(),
      })
      .returning();
    return created;
  }

  async getBtcAddressDerivation(invoiceId: string): Promise<BtcAddressDerivation | undefined> {
    const [derivation] = await db
      .select()
      .from(btcAddressDerivations)
      .where(eq(btcAddressDerivations.invoiceId, invoiceId));
    return derivation || undefined;
  }

  // Bitcoin payment state operations - production-ready state machine
  async createBtcPaymentState(state: InsertBtcPaymentState): Promise<BtcPaymentState> {
    const [created] = await db
      .insert(btcPaymentStates)
      .values({
        invoiceId: state.invoiceId,
        address: state.address,
        state: state.state,
        txid: state.txid || null,
        confirmations: state.confirmations?.toString() || "0",
        blockHeight: state.blockHeight?.toString() || null,
        amountSats: state.amountSats?.toString() || null,
      })
      .returning();
    return created;
  }

  async getBtcPaymentState(invoiceId: string): Promise<BtcPaymentState | undefined> {
    const [state] = await db
      .select()
      .from(btcPaymentStates)
      .where(eq(btcPaymentStates.invoiceId, invoiceId));
    return state || undefined;
  }

  async updateBtcPaymentState(invoiceId: string, updates: Partial<BtcPaymentState>): Promise<BtcPaymentState | undefined> {
    const [updated] = await db
      .update(btcPaymentStates)
      .set({
        ...updates,
        confirmations: updates.confirmations?.toString(),
        blockHeight: updates.blockHeight?.toString(),
        amountSats: updates.amountSats?.toString(),
        updatedAt: new Date(),
      })
      .where(eq(btcPaymentStates.invoiceId, invoiceId))
      .returning();
    return updated || undefined;
  }

  async getAllActiveBtcPaymentStates(): Promise<BtcPaymentState[]> {
    // Return all states that are not "settled" (unseen, pending, confirmed)
    return await db
      .select()
      .from(btcPaymentStates)
      .where(
        drizzleSql`${btcPaymentStates.state} != 'settled'`
      );
  }
}

export const storage = new MemStorage();
