import { type Invoice, type InsertInvoice, type WebhookLog, type PaymentTransaction, type Template, type InsertTemplate } from "@shared/schema";
import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";

export interface IStorage {
  // Invoice operations
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  getAllInvoices(): Promise<Invoice[]>;
  updateInvoiceStatus(id: string, status: string, paidAt?: Date): Promise<Invoice | undefined>;
  checkAndExpireInvoices(): Promise<number>;
  purgeExpiredInvoices(daysOld?: number): Promise<number>;
  
  // Payment transaction operations
  createPaymentTransaction(tx: {
    invoiceId: string;
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
      description: insertInvoice.description,
      paymentAddress: insertInvoice.paymentAddress,
      status: "pending",
      createdAt: now,
      paidAt: null,
      expiresAt: insertInvoice.expiresAt ? new Date(insertInvoice.expiresAt) : null,
    };
    
    this.invoices.set(id, invoice);
    return invoice;
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return Array.from(this.invoices.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
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
      paidAt: paidAt || invoice.paidAt,
    };

    this.invoices.set(id, updatedInvoice);
    return updatedInvoice;
  }

  async createPaymentTransaction(tx: {
    invoiceId: string;
    transactionId: string;
    confirmations: number;
    blockHeight?: number;
  }): Promise<PaymentTransaction> {
    const id = randomUUID();
    const transaction: PaymentTransaction = {
      id,
      invoiceId: tx.invoiceId,
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
}

export const storage = new MemStorage();
