import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSession } from "../negotiation/session.js";
import { buildMandate, parseIntentWithFallback, ParseError, type ParserSource, cartHash } from "../buyer/parser.js";
import { DEFAULT_POLICY, type OfferPolicy, type WaterfallStep } from "../types/policy.js";
import type { Product, FundedCampaign, RailOffer } from "../types/catalog.js";
import type { ReleaseLedgerEntry } from "../types/policy.js";
import { saveRecord, recentRecords, computeMetrics } from "./store.js";
import type { Rail } from "../types/mandate.js";
import { defaultExecutor, type PaymentExecutor } from "../payments/executor.js";
import { generateSigningKeyPair, signPayload, signTip } from "../audit/signing.js";
import { allowRequest, getClientIp } from "./ratelimit.js";
import { buildReceipt } from "../narrate/receipt.js";
import { randomBytes } from "node:crypto";
import {
  loadMerchantPolicy,
  loadCampaigns,
  loadRailOffers,
  loadProducts,
  loadSwapAlternatives,
  getReleaseLedger,
  addReleaseLedgerEntry,
  persistSession,
  persistAuditEvents,
  reserveInventory,
  releaseSessionReservations,
} from "./db-service.js";
import { getJWKS, verifyJWT, createJWT, createRefreshToken, verifyRefreshToken, revokeRefreshToken } from "./auth.js";

try {
  process.loadEnvFile();
} catch { }

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const executor: PaymentExecutor = defaultExecutor();
const signingKeys = generateSigningKeyPair();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://localhost:8787";
const MAX_INTENT_LENGTH = 500;
const VALID_WATERFALL_STEPS: WaterfallStep[] = ["funded_campaign", "rail_offer", "bundle_swap", "price_cut"];
const VALID_RAILS: Rail[] = ["upi", "card", "netbanking", "wallet"];
const VALID_CONSENT_SHARING = ["none", "anonymized_topk"] as const;

const csrfTokens = new Map<string, number>();
const CSRF_TOKEN_TTL_MS = 30 * 60 * 1000;

function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function validateCsrfToken(token: string | undefined): boolean {
  if (!token) return false;
  const issued = csrfTokens.get(token);
  if (!issued) return false;
  if (Date.now() - issued > CSRF_TOKEN_TTL_MS) {
    csrfTokens.delete(token);
    return false;
  }
  return true;
}

function consumeCsrfToken(token: string | undefined): boolean {
  if (!validateCsrfToken(token)) return false;
  csrfTokens.delete(token!);
  return true;
}

function issueCsrfToken(): string {
  const token = generateCsrfToken();
  csrfTokens.set(token, Date.now());
  return token;
}

interface SessionRequestBody {
  intentText?: string;
  skus?: Array<{ sku: string; qty: number }>;
  failRails?: string[];
  policyOverrides?: Partial<Pick<OfferPolicy, "floorMarginPct" | "dailyReleaseBudgetPaise" | "maxReleasesPerDay">>;
  waterfallDisabled?: string[];
  consentSharing?: "none" | "anonymized_topk";
  offerTtlMs?: number;
  forceDrift?: boolean;
  userId?: string;
}

interface ValidatedSessionBody {
  intentText: string | undefined;
  skus: Array<{ sku: string; qty: number }> | undefined;
  failRails: string[] | undefined;
  policyOverrides: Partial<Pick<OfferPolicy, "floorMarginPct" | "dailyReleaseBudgetPaise" | "maxReleasesPerDay">> | undefined;
  waterfallDisabled: string[] | undefined;
  consentSharing: "none" | "anonymized_topk" | undefined;
  offerTtlMs: number | undefined;
  forceDrift: boolean | undefined;
  userId: string | undefined;
}

interface ValidationError {
  field: string;
  message: string;
}

let productMap: Map<string, Product> = new Map();
let swapAlternatives: Record<string, string[]> = {};

async function initializeData() {
  const [products, swaps] = await Promise.all([
    loadProducts(),
    loadSwapAlternatives(),
  ]);
  productMap = new Map(products.map((p) => [p.sku, p]));
  swapAlternatives = swaps;
}

function productBySku(sku: string): Product | undefined {
  return productMap.get(sku);
}

function validateSessionBody(body: unknown): { valid: ValidatedSessionBody; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const b = body as Record<string, unknown>;

  if (b.intentText !== undefined) {
    if (typeof b.intentText !== "string") {
      errors.push({ field: "intentText", message: "intentText must be a string" });
    } else if (b.intentText.length > MAX_INTENT_LENGTH) {
      errors.push({ field: "intentText", message: `intentText exceeds max length of ${MAX_INTENT_LENGTH}` });
    }
  }

  if (b.skus !== undefined) {
    if (!Array.isArray(b.skus)) {
      errors.push({ field: "skus", message: "skus must be an array" });
    } else {
      for (let i = 0; i < b.skus.length; i++) {
        const sku = b.skus[i];
        if (!sku || typeof sku !== "object") {
          errors.push({ field: `skus[${i}]`, message: "each sku must be an object" });
          continue;
        }
        const s = sku as Record<string, unknown>;
        if (typeof s.sku !== "string" || !productBySku(s.sku)) {
          errors.push({ field: `skus[${i}].sku`, message: `invalid or unknown sku: ${s.sku}` });
        }
        if (s.qty !== undefined && (typeof s.qty !== "number" || s.qty < 1 || !Number.isInteger(s.qty))) {
          errors.push({ field: `skus[${i}].qty`, message: "qty must be a positive integer" });
        }
      }
    }
  }

  if (b.failRails !== undefined) {
    if (!Array.isArray(b.failRails)) {
      errors.push({ field: "failRails", message: "failRails must be an array" });
    } else {
      for (const rail of b.failRails) {
        if (!VALID_RAILS.includes(rail as Rail)) {
          errors.push({ field: "failRails", message: `invalid rail: ${rail}` });
        }
      }
    }
  }

  if (b.policyOverrides !== undefined) {
    if (b.policyOverrides !== null && typeof b.policyOverrides !== "object") {
      errors.push({ field: "policyOverrides", message: "policyOverrides must be an object" });
    } else {
      const po = b.policyOverrides as Record<string, unknown>;
      if (po.floorMarginPct !== undefined) {
        if (typeof po.floorMarginPct !== "number" || po.floorMarginPct < 0 || po.floorMarginPct > 100) {
          errors.push({ field: "policyOverrides.floorMarginPct", message: "floorMarginPct must be a number 0-100" });
        }
      }
      if (po.dailyReleaseBudgetPaise !== undefined) {
        if (typeof po.dailyReleaseBudgetPaise !== "number" || po.dailyReleaseBudgetPaise < 0) {
          errors.push({ field: "policyOverrides.dailyReleaseBudgetPaise", message: "dailyReleaseBudgetPaise must be a non-negative number" });
        }
      }
      if (po.maxReleasesPerDay !== undefined) {
        if (typeof po.maxReleasesPerDay !== "number" || po.maxReleasesPerDay < 0 || !Number.isInteger(po.maxReleasesPerDay)) {
          errors.push({ field: "policyOverrides.maxReleasesPerDay", message: "maxReleasesPerDay must be a non-negative integer" });
        }
      }
    }
  }

  if (b.waterfallDisabled !== undefined) {
    if (!Array.isArray(b.waterfallDisabled)) {
      errors.push({ field: "waterfallDisabled", message: "waterfallDisabled must be an array" });
    } else {
      for (const step of b.waterfallDisabled) {
        if (!VALID_WATERFALL_STEPS.includes(step as WaterfallStep)) {
          errors.push({ field: "waterfallDisabled", message: `invalid waterfall step: ${step}` });
        }
      }
    }
  }

  if (b.consentSharing !== undefined) {
    if (!VALID_CONSENT_SHARING.includes(b.consentSharing as typeof VALID_CONSENT_SHARING[number])) {
      errors.push({ field: "consentSharing", message: `consentSharing must be one of: ${VALID_CONSENT_SHARING.join(", ")}` });
    }
  }

  if (b.offerTtlMs !== undefined) {
    if (typeof b.offerTtlMs !== "number" || b.offerTtlMs < 0 || b.offerTtlMs > 3600000) {
      errors.push({ field: "offerTtlMs", message: "offerTtlMs must be a number 0-3600000 (1 hour max)" });
    }
  }

  if (b.forceDrift !== undefined && typeof b.forceDrift !== "boolean") {
    errors.push({ field: "forceDrift", message: "forceDrift must be a boolean" });
  }

  if (b.userId !== undefined && (typeof b.userId !== "string" || b.userId.length > 64 || !/^[A-Za-z0-9_.:-]+$/.test(b.userId))) {
    errors.push({ field: "userId", message: "userId must be <=64 chars of [A-Za-z0-9_.:-]" });
  }

  return {
    valid: {
      intentText: b.intentText as string | undefined,
      skus: b.skus as ValidatedSessionBody["skus"],
      failRails: b.failRails as string[] | undefined,
      policyOverrides: b.policyOverrides as ValidatedSessionBody["policyOverrides"],
      waterfallDisabled: b.waterfallDisabled as string[] | undefined,
      consentSharing: b.consentSharing as "none" | "anonymized_topk" | undefined,
      offerTtlMs: b.offerTtlMs as number | undefined,
      forceDrift: b.forceDrift as boolean | undefined,
      userId: b.userId as string | undefined,
    },
    errors,
  };
}

function buildPolicy(body: ValidatedSessionBody, basePolicy: OfferPolicy): OfferPolicy {
  const policy: OfferPolicy = {
    ...basePolicy,
    ...body.policyOverrides,
    waterfall: basePolicy.waterfall.map((w) => ({
      ...w,
      enabled: !(body.waterfallDisabled ?? []).includes(w.step),
    })),
  };
  return policy;
}

async function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function send(res: import("node:http").ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function sendError(res: import("node:http").ServerResponse, status: number, errors: ValidationError[]): void {
  send(res, status, { error: "Validation failed", details: errors });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/csrf-token") {
    const token = issueCsrfToken();
    send(res, 200, { csrfToken: token });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/console")) {
    const html = readFileSync(join(__dirname, "../../public/index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/buyer") {
    const html = readFileSync(join(__dirname, "../../public/buyer.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/demo") {
    const html = readFileSync(join(__dirname, "../../public/demo.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  // Explicit allowlist rather than a static directory handler: no path-traversal surface.
  if (req.method === "GET" && (url.pathname === "/demo.js" || url.pathname === "/demo-report.js" || url.pathname === "/metrics-data.js")) {
    const js = readFileSync(join(__dirname, "../../public" + url.pathname), "utf8");
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(js);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/parse") {
    const clientKey = getClientIp(req);
    if (!allowRequest(`parse:${clientKey}`)) {
      send(res, 429, { error: "Too many requests. Slow down." });
      return;
    }
    const body = await readJson(req);
    const csrfToken = body.csrfToken as string | undefined;
    if (!consumeCsrfToken(csrfToken)) {
      send(res, 403, { error: "Invalid or missing CSRF token" });
      return;
    }
    const intentText = typeof body.intentText === "string" ? body.intentText.trim() : "";
    if (!intentText) {
      send(res, 400, { error: "intentText is required." });
      return;
    }
    if (intentText.length > MAX_INTENT_LENGTH) {
      send(res, 400, { error: `intentText exceeds max length of ${MAX_INTENT_LENGTH}` });
      return;
    }
    try {
      const { parsed, parsedBy } = await parseIntentWithFallback(intentText);
      send(res, 200, {
        parsedBy,
        capPaise: parsed.capPaise,
        maxStretchPaise: parsed.maxStretchPaise,
        softCriteria: parsed.softCriteria,
        attachmentCriteria: parsed.attachmentCriteria,
        allowedRails: parsed.allowedRails,
      });
    } catch (e) {
      if (e instanceof ParseError) {
        send(res, 400, { error: e.message });
        return;
      }
      throw e;
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const [products, campaigns, railOffers, policy, releaseLedger] = await Promise.all([
      loadProducts(),
      loadCampaigns(),
      loadRailOffers(),
      loadMerchantPolicy(),
      getReleaseLedger(),
    ]);
    // Same day boundary the merchant gate uses, so the console shows the figure the gate enforces.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const releasedTodayPaise = releaseLedger
      .filter((e) => new Date(e.releasedAt) >= startOfDay)
      .reduce((sum, e) => sum + e.discountPaise, 0);
    send(res, 200, {
      catalog: products,
      offers: { campaigns, railOffers, coupons: [] },
      policy: {
        floorMarginPct: policy.floorMarginPct,
        dailyReleaseBudgetPaise: policy.dailyReleaseBudgetPaise,
        maxReleasesPerDay: policy.maxReleasesPerDay,
        cooldownMinutes: policy.cooldownMinutes,
        waterfall: policy.waterfall,
      },
      releasedTodayPaise,
      releasesToday: releaseLedger.filter((e) => new Date(e.releasedAt) >= startOfDay).length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/acp/feed") {
    const products = await loadProducts();
    send(res, 200, {
      protocol: "settle.agentic-feed",
      flavor: "ACP-inspired",
      version: "2026-08-26",
      merchant: { id: DEFAULT_POLICY.merchantId, name: "Settle Demo Store", currency: "INR" },
      items: products.map((p) => ({
        id: p.sku,
        title: p.title,
        brand: p.brand,
        category: p.category,
        price: { value: p.pricePaise / 100, currency: "INR" },
        payment_rails_supported: ["upi", "card", "netbanking", "wallet"],
        settle_negotiation: { rescue_eligible: true, attachment_eligible: p.category !== "electronics" },
      })),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/feed") {
    send(res, 200, { records: recentRecords(), metrics: computeMetrics() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
    const jwks = await getJWKS();
    send(res, 200, jwks);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    
    if (!email || !password) {
      send(res, 400, { error: "Email and password required" });
      return;
    }

    const { pool, query } = await import("../db/client.js");
    const crypto = await import("node:crypto");
    
    const result = await query<{ user_id: string; password_hash: string; merchant_id: string }>(
      `SELECT user_id, password_hash, merchant_id FROM admin_users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      send(res, 401, { error: "Invalid credentials" });
      return;
    }

    const user = result.rows[0]!;
    const [salt, hash] = user.password_hash.split(":");
    const inputHash = crypto.createHash("sha256").update(salt + password).digest("hex");
    
    if (hash !== inputHash) {
      send(res, 401, { error: "Invalid credentials" });
      return;
    }

    const userId = user.user_id;
    const merchantId = user.merchant_id;
    const accessToken = await createJWT({ sub: userId, merchant_id: merchantId, email, role: "admin" });
    const refreshToken = await createRefreshToken(userId);

    await query(
      `UPDATE admin_users SET last_login_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    send(res, 200, { accessToken, refreshToken, expiresIn: 3600 });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/refresh") {
    const body = await readJson(req);
    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
    
    if (!refreshToken) {
      send(res, 400, { error: "Refresh token required" });
      return;
    }

    const userId = await verifyRefreshToken(refreshToken);
    if (!userId) {
      send(res, 401, { error: "Invalid or expired refresh token" });
      return;
    }

    await revokeRefreshToken(refreshToken);
    
    const userResult = await (await import("../db/client.js")).query<{ email: string; merchant_id: string }>(
      `SELECT email, merchant_id FROM admin_users WHERE user_id = $1`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      send(res, 401, { error: "User not found" });
      return;
    }

    const user = userResult.rows[0]!;
    const merchantId = user.merchant_id;
    const accessToken = await createJWT({ sub: userId, merchant_id: merchantId, email: user.email, role: "admin" });
    const newRefreshToken = await createRefreshToken(userId);

    send(res, 200, { accessToken, refreshToken: newRefreshToken, expiresIn: 3600 });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const refreshToken = authHeader.slice(7);
      await revokeRefreshToken(refreshToken);
    }
    send(res, 200, { status: "ok" });
    return;
  }

  async function requireAdminAuth(req: any): Promise<{ userId: string; merchantId: string } | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    const payload = await verifyJWT(token);
    if (!payload || payload.role !== "admin") return null;
    return { userId: payload.sub as string, merchantId: payload.merchant_id as string };
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    const clientKey = getClientIp(req);
    if (!allowRequest(`session:${clientKey}`)) {
      send(res, 429, { error: "Too many sessions from this address. Slow down." });
      return;
    }
    const rawBody = await readJson(req);
    const csrfToken = rawBody.csrfToken as string | undefined;
    if (!consumeCsrfToken(csrfToken)) {
      send(res, 403, { error: "Invalid or missing CSRF token" });
      return;
    }
    const { valid: body, errors } = validateSessionBody(rawBody);
    if (errors.length > 0) {
      sendError(res, 400, errors);
      return;
    }
    const intentText = body.intentText?.trim() || "Get me these items under ₹5000";
    const skus = (body.skus ?? []).map((s) => ({ sku: s.sku, qty: s.qty ?? 1 }));
    if (skus.length === 0) {
      send(res, 400, { error: "No valid SKUs in request." });
      return;
    }

    let parsed;
    let parsedBy: ParserSource;
    try {
      ({ parsed, parsedBy } = await parseIntentWithFallback(intentText));
    } catch (e) {
      if (e instanceof ParseError) {
        send(res, 400, { error: e.message });
        return;
      }
      throw e;
    }

    const totalPaise = skus.reduce((sum, s) => sum + (productBySku(s.sku)?.pricePaise ?? 0) * s.qty, 0);
    const sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const cartHashValue = cartHash(skus);

    const mandate = buildMandate(
      body.userId ?? `user_${Math.random().toString(36).slice(2, 6)}`,
      intentText,
      parsed,
      cartHashValue,
      { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: body.consentSharing ?? "anonymized_topk" },
      new Date()
    );

    const [basePolicy, campaigns, releaseLedger, railOffers] = await Promise.all([
      loadMerchantPolicy(),
      loadCampaigns(),
      getReleaseLedger(),
      loadRailOffers(),
    ]);
    // The engine defaults to the static module catalog, which shares only 2 of 12 SKUs with the
    // database. Pass the same product list used to price the cart so the merchant gate sees real
    // costs, the swap step can resolve DB SKUs, and rail discounts match what /api/catalog shows.
    const dbProducts = [...productMap.values()];

    const policy = buildPolicy(body, basePolicy);

    // runSession appends to this array in place; anything past the mark is new this session.
    const releaseLedgerMark = releaseLedger.length;

    const reserveResult = await reserveInventory(sessionId, skus, 15);
    if (!reserveResult.success) {
      send(res, 409, { error: "Insufficient inventory", details: reserveResult.failed });
      return;
    }

    const result = await runSession({
      mandate,
      cart: { sessionId, items: skus, totalPaise, hash: body.forceDrift ? `drifted_${cartHashValue}` : cartHashValue },
      policy,
      releaseLedger,
      buyerContext: {
        cartBrands: [...new Set(skus.map((s) => productBySku(s.sku)!.brand))],
        cartCategories: [...new Set(skus.map((s) => productBySku(s.sku)!.category))],
        affinityTopBrands: [],
      },
      failRails: body.failRails ?? [],
      offerTtlMs: body.offerTtlMs,
      executor,
      campaigns,
      products: dbProducts,
      railOffers,
      swapAlternatives,
      signingKeys,
      now: new Date(),
    });

    await persistSession({
      sessionId,
      mandateId: mandate.mandateId,
      userIdHash: mandate.userId,
      cartItems: skus,
      cartTotalPaise: totalPaise,
      cartHash: cartHashValue,
      hardCapPaise: mandate.hardCapPaise,
      flexRule: mandate.flexRule,
      attachmentCriteria: mandate.attachmentCriteria,
      allowedRails: mandate.allowedRails,
      policySnapshot: policy,
      status: result.outcome === "PAID" || result.outcome === "DIRECT_PAID" ? "paid" : result.outcome.toLowerCase(),
      outcome: result.outcome,
      finalTotalPaise: result.finalTotalPaise,
      paidVia: result.paidVia,
      razorpayOrderId: result.razorpayOrderId,
      offerSnapshot: result.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED")?.event ?? null,
      buyerLedger: [...result.buyerLedger.all()],
      merchantLedger: [...result.merchantLedger.all()],
      tipSignatures: result.tipSignatures,
    });

    await persistAuditEvents(sessionId, [...result.buyerLedger.all()], [...result.merchantLedger.all()], signingKeys);

    // Without this the release_ledger table is never written, so the merchant gate evaluates its
    // daily budget, max-releases-per-day and per-user cooldown against a permanently empty list.
    for (const entry of releaseLedger.slice(releaseLedgerMark)) {
      await addReleaseLedgerEntry({ ...entry, sessionId });
    }

    if (result.updatedCampaigns) {
      for (const c of result.updatedCampaigns) {
        const original = campaigns.find((oc) => oc.campaignId === c.campaignId);
        if (original) {
          const spent = original.remainingBudgetPaise - c.remainingBudgetPaise;
          if (spent > 0) {
            const applied = await (await import("./db-service.js")).updateCampaignBudget(c.campaignId, spent);
            if (!applied) {
              console.warn("[campaign] overcommit: " + sessionId + " claimed " + spent + "p from " + c.campaignId + " but the budget was already drawn down");
            }
          }
        }
      }
    }

    if (result.outcome === "ABORTED" || result.outcome === "PAUSED_FOR_HUMAN" || result.reason === "NO_FITTING_OPTION") {
      await releaseSessionReservations(sessionId);
    }

    const lastOfferEvent = result.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED");
    const offer = lastOfferEvent ? ((lastOfferEvent.event as { offer?: { mechanism?: { step?: string }; merchantCostPaise?: number; fundedBy?: string } }).offer ?? null) : null;

    const crossSellEvent = result.merchantLedger.all().find((e) => e.kind === "CROSS_SELL_ACCEPTED");
    const crossSoldSku = crossSellEvent ? ((crossSellEvent.event as { sku?: string }).sku ?? null) : null;

    const receipt = await buildReceipt([...result.buyerLedger.all()], [...result.merchantLedger.all()]);

    saveRecord({
      sessionId,
      at: new Date().toISOString(),
      itemsLabel: skus.map((s) => `${productBySku(s.sku)!.title} x${s.qty}`).join(", "),
      cartTotalPaise: totalPaise,
      gapPaise: Math.max(0, totalPaise - mandate.hardCapPaise),
      mechanismStep: offer?.mechanism?.step ?? null,
      crossSoldSku,
      merchantCostPaise: offer?.merchantCostPaise ?? 0,
      fundedBy: offer?.fundedBy ?? null,
      outcome: result.outcome,
      finalTotalPaise: result.finalTotalPaise,
      paidVia: result.paidVia,
      reason: result.reason,
      intentText,
      parsedBy,
      consentSharing: body.consentSharing ?? "anonymized_topk",
      skus,
      buyerEvents: [...result.buyerLedger.all()],
      merchantEvents: [...result.merchantLedger.all()],
      chainsVerified: result.buyerLedger.verify() && result.merchantLedger.verify(),
      tipSignatures: result.tipSignatures,
      receipt,
    });

    send(res, 200, {
      sessionId,
      outcome: result.outcome,
      finalTotalPaise: result.finalTotalPaise,
      reason: result.reason,
      paidVia: result.paidVia,
      capPaise: mandate.hardCapPaise,
      parsedBy,
      razorpayOrderId: result.razorpayOrderId,
      tipSignatures: result.tipSignatures,
      narration: result.buyerLedger.all().find((e) => e.kind === "SETTLEMENT_RESULT"),
      buyerEvents: [...result.buyerLedger.all()],
      merchantEvents: [...result.merchantLedger.all()],
      verified: result.buyerLedger.verify() && result.merchantLedger.verify(),
      railsTested: (body.failRails ?? []) as Rail[],
      receipt,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/webhook/razorpay") {
    const { handleWebhook } = await import("../payments/webhook.js");
    await handleWebhook(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { status: "ok", timestamp: new Date().toISOString() });
    return;
  }

  send(res, 404, { error: "Not found" });
});

await initializeData();

if (process.env.SETTLE_NO_LISTEN !== "1") {
  server.listen(PORT, () => console.log(`Settle console → http://localhost:${PORT}`));
}

export { server };