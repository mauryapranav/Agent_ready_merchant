import { pool, query, transaction } from "../db/client.js";
import type { Product, FundedCampaign, RailOffer, SwapAlternatives } from "../types/catalog.js";
import type { OfferPolicy, ReleaseLedgerEntry, WaterfallStep } from "../types/policy.js";
import type { CounterOffer } from "../types/catalog.js";

export const MERCHANT_ID = process.env.RAZORPAY_MERCHANT_ID ?? "merchant_settle_demo";

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function mapKeys<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value;
  }
  return result as T;
}

export async function loadMerchantPolicy(): Promise<OfferPolicy> {
  const result = await query<any>(
    `SELECT floor_margin_pct, max_releases_per_day, daily_release_budget_paise, cooldown_minutes, waterfall_config
     FROM merchants WHERE merchant_id = $1`,
    [MERCHANT_ID]
  );
  if (result.rows.length === 0) {
    return {
      merchantId: MERCHANT_ID,
      waterfall: [
        { step: "funded_campaign", enabled: true },
        { step: "rail_offer", enabled: true },
        { step: "bundle_swap", enabled: true },
        { step: "price_cut", enabled: true },
      ],
      floorMarginPct: 12,
      maxReleasesPerDay: 50,
      dailyReleaseBudgetPaise: 500000,
      cooldownMinutes: 30,
    };
  }
  const row = mapKeys(result.rows[0]);
  return {
    merchantId: MERCHANT_ID,
    waterfall: row.waterfallConfig as OfferPolicy["waterfall"],
    floorMarginPct: row.floorMarginPct,
    maxReleasesPerDay: row.maxReleasesPerDay,
    dailyReleaseBudgetPaise: Number(row.dailyReleaseBudgetPaise),
    cooldownMinutes: row.cooldownMinutes,
  };
}

export async function loadCampaigns(): Promise<FundedCampaign[]> {
  const now = new Date();
  const result = await query<any>(
    `SELECT campaign_id, label, flat_off_paise, min_cart_paise, funded_by, 
            remaining_budget_paise, valid_to
     FROM campaigns 
     WHERE merchant_id = $1 AND is_active = true AND valid_to > $2
     ORDER BY flat_off_paise ASC`,
    [MERCHANT_ID, now]
  );
  return result.rows.map((row) => {
    const r = mapKeys(row);
    return {
      campaignId: r.campaignId,
      label: r.label,
      flatOffPaise: Number(r.flatOffPaise),
      minCartPaise: Number(r.minCartPaise),
      fundedBy: r.fundedBy,
      remainingBudgetPaise: Number(r.remainingBudgetPaise),
      validTo: r.validTo,
    };
  });
}

export async function loadRailOffers(): Promise<RailOffer[]> {
  const now = new Date();
  const result = await query<any>(
    `SELECT offer_id, rail, label, discount_pct, max_discount_paise, funded_by, valid_to
     FROM rail_offers
     WHERE merchant_id = $1 AND is_active = true AND valid_to > $2`,
    [MERCHANT_ID, now]
  );
  return result.rows.map((row) => {
    const r = mapKeys(row);
    return {
      offerId: r.offerId,
      rail: r.rail,
      label: r.label,
      discountPct: Number(r.discountPct),
      maxDiscountPaise: Number(r.maxDiscountPaise),
      fundedBy: r.fundedBy,
      validTo: r.validTo,
    };
  });
}

export async function loadProducts(): Promise<Product[]> {
  const result = await query<any>(
    `SELECT sku, title, brand, category, price_paise, cost_paise, image_hint
     FROM products
     WHERE merchant_id = $1 AND is_active = true`,
    [MERCHANT_ID]
  );
  return result.rows.map((row) => {
    const r = mapKeys(row);
    return {
      sku: r.sku,
      title: r.title,
      brand: r.brand,
      category: r.category,
      pricePaise: Number(r.pricePaise),
      costPaise: Number(r.costPaise),
      imageHint: r.imageHint,
    };
  });
}

export async function loadSwapAlternatives(): Promise<SwapAlternatives> {
  const result = await query<{ from_sku: string; to_sku: string }>(
    `SELECT from_sku, to_sku FROM swap_alternatives WHERE from_sku IN (SELECT sku FROM products WHERE merchant_id = $1 AND is_active = true)`,
    [MERCHANT_ID]
  );
  const map: SwapAlternatives = {};
  for (const row of result.rows) {
    if (!map[row.from_sku]) map[row.from_sku] = [];
    map[row.from_sku]!.push(row.to_sku!);
  }
  return map;
}

export async function getCampaignsForWaterfall(): Promise<FundedCampaign[]> {
  return loadCampaigns();
}

/**
 * Decrements a campaign budget, refusing to go negative. The guard makes the write safe against
 * the read-modify-write window between loadCampaigns() and this call: if two sessions both saw
 * enough budget, the second UPDATE matches no row and returns false rather than overdrawing.
 */
export async function updateCampaignBudget(campaignId: string, spentPaise: number): Promise<boolean> {
  const result = await query(
    `UPDATE campaigns SET remaining_budget_paise = remaining_budget_paise - $1, updated_at = NOW()
     WHERE campaign_id = $2 AND merchant_id = $3 AND remaining_budget_paise >= $1`,
    [spentPaise, campaignId, MERCHANT_ID]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getReleaseLedger(): Promise<ReleaseLedgerEntry[]> {
  const result = await query<any>(
    `SELECT released_at, user_id_hash, step, discount_paise
     FROM release_ledger
     WHERE merchant_id = $1
     ORDER BY released_at DESC
     LIMIT 1000`,
    [MERCHANT_ID]
  );
  return result.rows.map((row) => {
    const r = mapKeys(row);
    return {
      releasedAt: r.releasedAt,
      userIdHash: r.userIdHash,
      step: r.step as WaterfallStep,
      discountPaise: Number(r.discountPaise),
    };
  });
}

export async function addReleaseLedgerEntry(entry: ReleaseLedgerEntry & { sessionId?: string }): Promise<void> {
  await query(
    `INSERT INTO release_ledger (merchant_id, session_id, user_id_hash, step, discount_paise, released_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [MERCHANT_ID, entry.sessionId ?? "unknown", entry.userIdHash, entry.step, entry.discountPaise, entry.releasedAt]
  );
}

export async function persistSession(params: {
  sessionId: string;
  mandateId: string;
  userIdHash: string;
  cartItems: Array<{ sku: string; qty: number }>;
  cartTotalPaise: number;
  cartHash: string;
  hardCapPaise: number;
  flexRule: any;
  attachmentCriteria: any;
  allowedRails: string[];
  policySnapshot: any;
  status: string;
  outcome?: string;
  finalTotalPaise?: number | null;
  paidVia?: string | null;
  razorpayOrderId?: string | null;
  offerSnapshot?: any;
  buyerLedger?: any[];
  merchantLedger?: any[];
  tipSignatures?: any;
}): Promise<void> {
  await query(
    `INSERT INTO sessions (session_id, merchant_id, mandate_id, user_id_hash, cart_items, cart_total_paise, cart_hash,
                           hard_cap_paise, flex_rule, attachment_criteria, allowed_rails, policy_snapshot,
                           status, outcome, final_total_paise, paid_via, razorpay_order_id, offer_snapshot,
                           buyer_ledger, merchant_ledger, tip_signatures)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     ON CONFLICT (session_id) DO UPDATE SET
       status = EXCLUDED.status,
       outcome = EXCLUDED.outcome,
       final_total_paise = EXCLUDED.final_total_paise,
       paid_via = EXCLUDED.paid_via,
       razorpay_order_id = EXCLUDED.razorpay_order_id,
       offer_snapshot = EXCLUDED.offer_snapshot,
       buyer_ledger = EXCLUDED.buyer_ledger,
       merchant_ledger = EXCLUDED.merchant_ledger,
       tip_signatures = EXCLUDED.tip_signatures,
       updated_at = NOW()`,
    [
      params.sessionId,
      MERCHANT_ID,
      params.mandateId,
      params.userIdHash,
      JSON.stringify(params.cartItems),
      params.cartTotalPaise,
      params.cartHash,
      params.hardCapPaise,
      JSON.stringify(params.flexRule),
      JSON.stringify(params.attachmentCriteria),
      // allowed_rails is TEXT[], not JSONB: node-postgres maps a JS array to a Postgres array,
      // whereas a JSON string arrives as the literal ["upi","card"] and is rejected.
      params.allowedRails,
      JSON.stringify(params.policySnapshot),
      params.status,
      params.outcome ?? null,
      params.finalTotalPaise ?? null,
      params.paidVia ?? null,
      params.razorpayOrderId ?? null,
      JSON.stringify(params.offerSnapshot ?? null),
      JSON.stringify(params.buyerLedger ?? []),
      JSON.stringify(params.merchantLedger ?? []),
      JSON.stringify(params.tipSignatures ?? null),
    ]
  );
}

export async function persistAuditEvents(
  sessionId: string,
  buyerEvents: any[],
  merchantEvents: any[],
  signingKeys: { privateKeyPem: string; publicKeyPem: string }
): Promise<void> {
  for (const event of buyerEvents) {
    const chainHash = "";
    await query(
      `INSERT INTO audit_events (ledger_type, session_id, event_kind, event_data, chain_hash, created_at)
       VALUES ('buyer', $1, $2, $3, $4, NOW())`,
      [sessionId, event.kind, JSON.stringify(event.event), chainHash]
    );
  }

  for (const event of merchantEvents) {
    const chainHash = "";
    await query(
      `INSERT INTO audit_events (ledger_type, session_id, event_kind, event_data, chain_hash, created_at)
       VALUES ('merchant', $1, $2, $3, $4, NOW())`,
      [sessionId, event.kind, JSON.stringify(event.event), chainHash]
    );
  }
}

/**
 * Recent settled sessions for the transaction history view. Reads the persisted table rather
 * than the in-memory store, so history survives a restart and reflects what actually committed.
 */
export async function loadRecentSessions(limit = 50): Promise<Array<Record<string, unknown>>> {
  const result = await query<any>(
    `SELECT session_id, user_id_hash, cart_items, cart_total_paise, hard_cap_paise,
            status, outcome, final_total_paise, paid_via, razorpay_order_id,
            offer_snapshot, created_at
     FROM sessions
     WHERE merchant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [MERCHANT_ID, limit]
  );
  return result.rows.map((row) => {
    const r = mapKeys(row);
    const offer = (r.offerSnapshot as { offer?: Record<string, any> } | null)?.offer ?? null;
    return {
      sessionId: r.sessionId,
      at: r.createdAt,
      items: r.cartItems,
      cartTotalPaise: Number(r.cartTotalPaise),
      capPaise: Number(r.hardCapPaise),
      outcome: r.outcome ?? String(r.status ?? "").toUpperCase(),
      finalTotalPaise: r.finalTotalPaise === null ? null : Number(r.finalTotalPaise),
      paidVia: r.paidVia ?? null,
      razorpayOrderId: r.razorpayOrderId ?? null,
      mechanismStep: offer?.mechanism?.step ?? null,
      fundedBy: offer?.fundedBy ?? null,
      merchantCostPaise: offer ? Number(offer.merchantCostPaise ?? 0) : 0,
    };
  });
}

export async function getInventory(): Promise<Record<string, { total: number; reserved: number }>> {
  const result = await query<any>(
    `SELECT sku, total_qty, reserved_qty FROM inventory WHERE merchant_id = $1`,
    [MERCHANT_ID]
  );
  const map: Record<string, { total: number; reserved: number }> = {};
  for (const row of result.rows) {
    const r = mapKeys(row);
    map[r.sku] = { total: r.totalQty, reserved: r.reservedQty };
  }
  return map;
}

export async function reserveInventory(
  sessionId: string,
  items: Array<{ sku: string; qty: number }>,
  ttlMinutes: number = 15
): Promise<{ success: boolean; reservationIds: string[]; failed?: Array<{ sku: string; reason: string }> }> {
  const reservationIds: string[] = [];
  const failed: Array<{ sku: string; reason: string }> = [];

  for (const item of items) {
    const result = await query<any>(
      `SELECT total_qty, reserved_qty FROM inventory WHERE sku = $1 AND merchant_id = $2 FOR UPDATE`,
      [item.sku, MERCHANT_ID]
    );

    if (result.rows.length === 0) {
      failed.push({ sku: item.sku, reason: "Product not found" });
      continue;
    }

    const r = mapKeys(result.rows[0]);
    if (r.totalQty - r.reservedQty < item.qty) {
      failed.push({ sku: item.sku, reason: "Insufficient inventory" });
      continue;
    }

    const reservationId = `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await transaction(async (client) => {
      await client.query(`UPDATE inventory SET reserved_qty = reserved_qty + $1 WHERE sku = $2`, [item.qty, item.sku]);
      await client.query(
        `INSERT INTO inventory_reservations (reservation_id, session_id, sku, qty, status, expires_at)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [reservationId, sessionId, item.sku, item.qty, expiresAt]
      );
    });

    reservationIds.push(reservationId);
  }

  return failed.length === 0 && reservationIds.length === items.length
    ? { success: true, reservationIds }
    : { success: false, reservationIds, failed };
}

export async function confirmReservation(reservationId: string): Promise<void> {
  await query(
    `UPDATE inventory_reservations SET status = 'confirmed' WHERE reservation_id = $1`,
    [reservationId]
  );
}

export async function releaseReservation(reservationId: string): Promise<void> {
  const result = await query<any>(
    `SELECT sku, qty FROM inventory_reservations WHERE reservation_id = $1 AND status = 'pending'`,
    [reservationId]
  );

  if (result.rows.length === 0) return;

  const r = mapKeys(result.rows[0]);

  await transaction(async (client) => {
    await client.query(`UPDATE inventory SET reserved_qty = reserved_qty - $1 WHERE sku = $2`, [r.qty, r.sku]);
    await client.query(`UPDATE inventory_reservations SET status = 'released' WHERE reservation_id = $1`, [reservationId]);
  });
}

export async function releaseSessionReservations(sessionId: string): Promise<void> {
  const result = await query<any>(
    `SELECT reservation_id, sku, qty FROM inventory_reservations WHERE session_id = $1 AND status = 'pending'`,
    [sessionId]
  );

  for (const row of result.rows) {
    const r = mapKeys(row);
    await transaction(async (client) => {
      await client.query(`UPDATE inventory SET reserved_qty = reserved_qty - $1 WHERE sku = $2`, [r.qty, r.sku]);
      await client.query(`UPDATE inventory_reservations SET status = 'released' WHERE reservation_id = $1`, [r.reservationId]);
    });
  }
}