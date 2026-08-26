import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSession } from "../negotiation/session.js";
import { buildMandate, parseIntentDeterministic, ParseError } from "../buyer/parser.js";
import { DEFAULT_POLICY, type OfferPolicy } from "../types/policy.js";
import { productBySku } from "../merchant/data.js";
import { CATALOG, OFFER_SURFACE } from "../merchant/data.js";
import { saveRecord, recentRecords, computeMetrics } from "./store.js";
import type { Rail } from "../types/mandate.js";
import { defaultExecutor, type PaymentExecutor } from "../payments/executor.js";
import { generateSigningKeyPair } from "../audit/signing.js";
import { allowRequest } from "./ratelimit.js";
import { buildReceipt } from "../narrate/receipt.js";

try{
  process.loadEnvFile();
}catch{
}
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const executor: PaymentExecutor = defaultExecutor();
const campaignBudget: import("../types/catalog.js").FundedCampaign[] = structuredClone(OFFER_SURFACE.campaigns);
const signingKeys = generateSigningKeyPair();

interface SessionRequestBody {
  intentText?: string;
  skus?: Array<{ sku: string; qty: number }>;
  failRails?: string[];
  policyOverrides?: Partial<Pick<OfferPolicy, "floorMarginPct" | "dailyReleaseBudgetPaise" | "maxReleasesPerDay">>;
  waterfallDisabled?: string[];
  consentSharing?: "none" | "anonymized_topk";
  offerTtlMs?: number;
  forceDrift?: boolean;
}

function buildPolicy(body: SessionRequestBody): OfferPolicy {
  const policy: OfferPolicy = {
    ...DEFAULT_POLICY,
    ...body.policyOverrides,
    waterfall: DEFAULT_POLICY.waterfall.map((w) => ({
      ...w,
      enabled: !(body.waterfallDisabled ?? []).includes(w.step),
    })),
  };
  return policy;
}

async function readJson(req: import("node:http").IncomingMessage): Promise<SessionRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function send(res: import("node:http").ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/console")) {
    const html = readFileSync(join(__dirname, "../../public/index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    send(res, 200, { catalog: CATALOG, offers: OFFER_SURFACE });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/feed") {
    send(res, 200, { records: recentRecords(), metrics: computeMetrics() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    const clientKey = req.socket.remoteAddress ?? "unknown";
    if (!allowRequest(`session:${clientKey}`)) {
      send(res, 429, { error: "Too many sessions from this address. Slow down." });
      return;
    }
    const body = await readJson(req);
    const intentText = body.intentText?.trim() || "Get me these items under ₹5000";
    const skus = (body.skus ?? []).filter((s) => productBySku(s.sku));
    if (skus.length === 0) {
      send(res, 400, { error: "No valid SKUs in request." });
      return;
    }

    let parsed;
    try {
      parsed = parseIntentDeterministic(intentText);
    } catch (e) {
      if (e instanceof ParseError) {
        send(res, 400, { error: e.message });
        return;
      }
      throw e;
    }

    const totalPaise = skus.reduce((sum, s) => sum + productBySku(s.sku)!.pricePaise * s.qty, 0);
    const sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const cartHashValue = (await import("../buyer/parser.js")).cartHash(skus);

    const mandate = buildMandate(
      `user_${Math.random().toString(36).slice(2, 6)}`,
      intentText,
      parsed,
      cartHashValue,
      { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: body.consentSharing ?? "anonymized_topk" },
      new Date()
    );

    const releaseLedger: import("../types/policy.js").ReleaseLedgerEntry[] = [];
    const result = await runSession({
      mandate,
      cart: { sessionId, items: skus, totalPaise, hash: body.forceDrift ? `drifted_${cartHashValue}` : cartHashValue },
      policy: buildPolicy(body),
      releaseLedger,
      buyerContext: {
        cartBrands: [...new Set(skus.map((s) => productBySku(s.sku)!.brand))],
        cartCategories: [...new Set(skus.map((s) => productBySku(s.sku)!.category))],
        affinityTopBrands: [],
      },
      failRails: body.failRails ?? [],
      offerTtlMs: body.offerTtlMs,
      executor,
      campaigns: campaignBudget,
      signingKeys,
      now: new Date(),
    });

    const lastOfferEvent = result.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED");
    const offer = lastOfferEvent ? ((lastOfferEvent.event as { offer?: { mechanism?: { step?: string }; merchantCostPaise?: number; fundedBy?: string } }).offer ?? null) : null;

    const crossSellEvent = result.merchantLedger.all().find((e) => e.kind === "CROSS_SELL_ACCEPTED");
    const crossSoldSku = crossSellEvent ? ((crossSellEvent.event as { sku?: string }).sku ?? null) : null;

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
      buyerEvents: [...result.buyerLedger.all()],
      merchantEvents: [...result.merchantLedger.all()],
      chainsVerified: result.buyerLedger.verify() && result.merchantLedger.verify(),
      tipSignatures: result.tipSignatures,
    });

    const receipt = await buildReceipt([...result.buyerLedger.all()], [...result.merchantLedger.all()]);

    send(res, 200, {
      sessionId,
      outcome: result.outcome,
      finalTotalPaise: result.finalTotalPaise,
      reason: result.reason,
      paidVia: result.paidVia,
      capPaise: mandate.hardCapPaise,
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

  send(res, 404, { error: "Not found" });
});

if (process.env.SETTLE_NO_LISTEN !== "1") {
  server.listen(PORT, () => console.log(`Settle console → http://localhost:${PORT}`));
}

export { server };
