import { db } from './db';
import { eq, max, sql as drizzleSql, and } from 'drizzle-orm';
import { btcAddressDerivations, btcPaymentStates } from '../../shared/schema';
import type {
  BtcAddressDerivation,
  BtcPaymentState,
} from '../../shared/schema';

export interface InsertBtcAddressDerivation {
  invoiceId: string;
  address: string;
  derivationIndex: number;
  derivationPath: string;
  amountSats: number;
}

export interface InsertBtcPaymentState {
  invoiceId: string;
  address: string;
  state: "unseen" | "pending" | "confirmed" | "settled";
  txid?: string;
  confirmations?: number;
  blockHeight?: number;
  amountSats?: number;
}

export class BtcStorage {
  // Address derivation operations - production-ready persistence
  async getNextDerivationIndex(): Promise<number> {
    const result = await db
      .select({ maxIndex: max(btcAddressDerivations.derivationIndex) })
      .from(btcAddressDerivations);
    
    const maxIndex = result[0]?.maxIndex;
    return maxIndex ? parseInt(maxIndex) + 1 : 0;
  }

  async createAddressDerivation(derivation: InsertBtcAddressDerivation): Promise<BtcAddressDerivation> {
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

  async getAddressDerivation(invoiceId: string): Promise<BtcAddressDerivation | undefined> {
    const [derivation] = await db
      .select()
      .from(btcAddressDerivations)
      .where(eq(btcAddressDerivations.invoiceId, invoiceId));
    return derivation || undefined;
  }

  // Payment state operations - production-ready state machine
  async createPaymentState(state: InsertBtcPaymentState): Promise<BtcPaymentState> {
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

  async getPaymentState(invoiceId: string): Promise<BtcPaymentState | undefined> {
    const [state] = await db
      .select()
      .from(btcPaymentStates)
      .where(eq(btcPaymentStates.invoiceId, invoiceId));
    return state || undefined;
  }

  async updatePaymentState(invoiceId: string, updates: Partial<BtcPaymentState>): Promise<BtcPaymentState | undefined> {
    const [updated] = await db
      .update(btcPaymentStates)
      .set({
        ...updates,
        confirmations: updates.confirmations ? updates.confirmations.toString() : undefined,
        blockHeight: updates.blockHeight ? updates.blockHeight.toString() : undefined,
        amountSats: updates.amountSats ? updates.amountSats.toString() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(btcPaymentStates.invoiceId, invoiceId))
      .returning();
    return updated || undefined;
  }

  async getAllActivePaymentStates(): Promise<BtcPaymentState[]> {
    // Return all states that are not "settled" (unseen, pending, confirmed)
    return await db
      .select()
      .from(btcPaymentStates)
      .where(
        drizzleSql`${btcPaymentStates.state} != 'settled'`
      );
  }

  // Get states for reorg monitoring (recently settled within window)
  async getRecentlySettledStates(windowMs: number): Promise<BtcPaymentState[]> {
    const cutoffTime = new Date(Date.now() - windowMs);
    return await db
      .select()
      .from(btcPaymentStates)
      .where(
        and(
          eq(btcPaymentStates.state, "settled"),
          drizzleSql`${btcPaymentStates.paidAt} > ${cutoffTime}`
        )
      );
  }
}

export const storage = new BtcStorage();
