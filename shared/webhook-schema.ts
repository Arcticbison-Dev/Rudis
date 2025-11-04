import { z } from "zod";

export const paymentConfirmationSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice ID format"),
  transactionId: z.string().min(1, "Transaction ID is required"),
  confirmations: z.number().int().min(0, "Confirmations must be non-negative"),
  blockHeight: z.number().int().optional(),
  timestamp: z.string().datetime().optional(),
});

export type PaymentConfirmation = z.infer<typeof paymentConfirmationSchema>;

export const webhookPayloadSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.string(),
  currency: z.string(),
  status: z.string(),
  paidAt: z.date().nullable(),
  transactionId: z.string().optional(),
  confirmations: z.number().optional(),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
