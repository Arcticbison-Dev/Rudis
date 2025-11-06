import { type Invoice, type InsertInvoice, type WebhookLog, type PaymentTransaction, type Template, type InsertTemplate } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Invoice operations
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  getAllInvoices(): Promise<Invoice[]>;
  updateInvoiceStatus(id: string, status: string, paidAt?: Date): Promise<Invoice | undefined>;
  checkAndExpireInvoices(): Promise<number>;
  
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
    payload?: string;
    responseBody?: string;
    attempt?: number;
  }): Promise<WebhookLog>;
  getWebhookLogsByInvoice(invoiceId: string): Promise<WebhookLog[]>;
  
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

  constructor() {
    this.invoices = new Map();
    this.webhookLogs = new Map();
    this.paymentTransactions = new Map();
    this.templates = new Map();
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
    payload?: string;
    responseBody?: string;
    attempt?: number;
  }): Promise<WebhookLog> {
    const id = randomUUID();
    const webhookLog: WebhookLog = {
      id,
      invoiceId: log.invoiceId,
      url: log.url,
      status: log.status,
      statusCode: log.statusCode?.toString() || null,
      errorMessage: log.errorMessage || null,
      payload: log.payload || null,
      responseBody: log.responseBody || null,
      attempt: log.attempt?.toString() || "1",
      createdAt: new Date(),
    };

    this.webhookLogs.set(id, webhookLog);
    return webhookLog;
  }

  async getWebhookLogsByInvoice(invoiceId: string): Promise<WebhookLog[]> {
    return Array.from(this.webhookLogs.values())
      .filter((log) => log.invoiceId === invoiceId)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
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
      name: insertTemplate.name,
      description: insertTemplate.description || null,
      amount: (insertTemplate.amount && insertTemplate.amount.trim() !== "") ? insertTemplate.amount : null,
      currency: insertTemplate.currency,
      paymentAddress: (insertTemplate.paymentAddress && insertTemplate.paymentAddress.trim() !== "") ? insertTemplate.paymentAddress : null,
      expiresInHours: (insertTemplate.expiresInHours && insertTemplate.expiresInHours.trim() !== "") ? insertTemplate.expiresInHours : null,
      createdAt: now,
    };
    
    this.templates.set(id, template);
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
      ...(updates.amount !== undefined && { amount: (updates.amount && updates.amount.trim() !== "") ? updates.amount : null }),
      ...(updates.paymentAddress !== undefined && { paymentAddress: (updates.paymentAddress && updates.paymentAddress.trim() !== "") ? updates.paymentAddress : null }),
      ...(updates.expiresInHours !== undefined && { expiresInHours: (updates.expiresInHours && updates.expiresInHours.trim() !== "") ? updates.expiresInHours : null }),
    };

    const updatedTemplate: Template = {
      ...template,
      ...sanitizedUpdates,
    };

    this.templates.set(id, updatedTemplate);
    return updatedTemplate;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.templates.delete(id);
  }
}

export const storage = new MemStorage();
