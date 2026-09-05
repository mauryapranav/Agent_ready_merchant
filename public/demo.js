/* Settle — Merchant Control Room.
 *
 * Runs the scripted buyer roster against the real /api/session endpoint, one buyer at a time
 * (order matters: campaign budgets deplete as they go), then replays each completed session at
 * a readable pace. Every beat shown here is reconstructed from the audit events the API already
 * returns — there is no separate demo code path in the negotiation engine.
 */

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rs = (p) => "₹" + Number(Math.round(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Verified against the seeded catalog and campaign budgets: this roster walks every
 * waterfall branch. Buyers 1-3 share an intent and product on purpose — the third one
 * falls through to the rail offer because the first two drained the Nike campaign. */
const ROSTER = [
  { name: "Ananya", userId: "demo_ananya", sku: "nike-peg-41",
    intent: "Get me these running shoes under 3700", expect: "brand campaign" },
  { name: "Rohit", userId: "demo_rohit", sku: "nike-peg-41",
    intent: "Get me these running shoes under 3700", expect: "brand campaign (drains it)" },
  { name: "Meera", userId: "demo_meera", sku: "nike-peg-41",
    intent: "Get me these running shoes under 3700", expect: "campaign gone, falls to rail" },
  { name: "Vikram", userId: "demo_vikram", sku: "adidas-ultra-24",
    intent: "Get me these under 3400", expect: "bundle swap" },
  { name: "Priya", userId: "demo_priya", sku: "adidas-hoodie",
    intent: "Get me this hoodie under 2000", expect: "merchant pays" },
  { name: "Arjun", userId: "demo_arjun", sku: "adidas-backpack",
    intent: "Get me this backpack under 650", expect: "floor holds, no deal" },
  { name: "Kavya", userId: "demo_kavya", sku: "nike-peg-41",
    intent: "Get me these under 5000. Extras only from Jockey.", expect: "under cap, attaches" },
  { name: "Dev", userId: "demo_dev", sku: "adidas-hoodie",
    intent: "Get me this under 1250, can stretch by 800 if it is really Nike",
    expect: "stretch unmet, hands back" },
];

const MECH = {
  funded_campaign: { label: "Brand campaign", css: "--m-campaign", who: "the brand" },
  rail_offer: { label: "Bank rail offer", css: "--m-rail", who: "a bank or card network" },
  bundle_swap: { label: "Bundle swap", css: "--m-swap", who: "nobody — a cheaper equivalent" },
  price_cut: { label: "Direct price cut", css: "--m-cut", who: "the merchant" },
};
const FUNDER = {
  brand: "the brand", bank: "a bank", network: "a card network",
  merchant_marketing: "the merchant’s marketing budget",
  merchant_margin: "the merchant’s own margin",
};

const state = { catalog: [], bySku: {}, campaigns: [], policy: null, dailyCap: 0, dailySpent: 0,
  results: [], autoRun: false };

/* ---------- setup ---------- */

async function boot() {
  const res = await fetch("/api/catalog");
  const data = await res.json();
  state.catalog = data.catalog || [];
  state.bySku = Object.fromEntries(state.catalog.map((p) => [p.sku, p]));
  state.campaigns = (data.offers?.campaigns || []).map((c) => ({ ...c, startPaise: c.remainingBudgetPaise }));
  state.policy = data.policy || null;
  state.dailyCap = data.policy?.dailyReleaseBudgetPaise ?? 0;
  state.dailySpent = data.releasedTodayPaise ?? 0;
  renderPolicy();
  renderMeters();
  renderRoster();
  warnIfStale();
}

/* The waterfall fall-through only lands if the campaign pool starts full. Budgets and the
 * release ledger persist in the database between runs, so a second rehearsal opens on a
 * drained pool and the demo quietly loses its point. Say so before anyone presses run. */
function warnIfStale() {
  const drained = state.campaigns.filter((c) => c.remainingBudgetPaise < c.startPaise);
  const spent = state.dailySpent > 0;
  if (!drained.length && !spent) return;
  const bits = [];
  if (drained.length) bits.push(drained.length + " campaign budget(s) already drawn down");
  if (spent) bits.push(rs(state.dailySpent) + " of the daily discount budget already spent");
  $("#stale-warn").innerHTML = `<div class="stale">
    <b>State left over from a previous run</b> — ${bits.join(" and ")}.
    The campaign fall-through will not demonstrate correctly. Reset the demo merchant before presenting.
  </div>`;
}

function renderPolicy() {
  const p = state.policy;
  if (!p) return;
  $("#p-floor").textContent = p.floorMarginPct + "%";
  $("#p-rel").textContent = p.maxReleasesPerDay;
  $("#p-cool").textContent = p.cooldownMinutes + " min";
  $("#wf-order").innerHTML = (p.waterfall || [])
    .filter((w) => w.enabled)
    .map((w, i) => {
      const m = MECH[w.step];
      return `<div class="wf-step" data-step="${w.step}">
        <span class="ord">${i + 1}</span>
        <span class="dot" style="background:var(${m.css})"></span>
        <span class="nm">${m.label}</span></div>`;
    }).join("");
}

function meter(label, usedPaise, capPaise, colorVar, drained) {
  const pct = capPaise > 0 ? Math.max(0, Math.min(100, (usedPaise / capPaise) * 100)) : 0;
  return `<div class="meter ${drained ? "drained" : ""}">
    <div class="mtop"><span class="lbl">${esc(label)}</span>
      <span class="val">${rs(capPaise - usedPaise)} left</span></div>
    <div class="track"><div class="fill" style="width:${100 - pct}%;background:var(${colorVar})"></div></div>
  </div>`;
}

function renderMeters() {
  $("#daily").innerHTML = meter(
    "Spent " + rs(state.dailySpent) + " of " + rs(state.dailyCap),
    state.dailySpent, state.dailyCap, "--m-cut", state.dailySpent >= state.dailyCap);
  $("#camps").innerHTML = state.campaigns.map((c) =>
    meter(c.label, c.startPaise - c.remainingBudgetPaise, c.startPaise, "--m-campaign",
      c.remainingBudgetPaise < c.flatOffPaise)).join("") || `<p class="sub">No active campaigns.</p>`;

  const allDry = state.campaigns.length > 0 &&
    state.campaigns.every((c) => c.remainingBudgetPaise < c.flatOffPaise);
  const el = document.querySelector('.wf-step[data-step="funded_campaign"]');
  if (el) el.classList.toggle("exhausted", allDry);
}

function renderRoster(activeIdx = -1) {
  $("#rost").innerHTML = ROSTER.map((b, i) => {
    const r = state.results[i];
    const st = r ? shortOutcome(r.outcome) : i === activeIdx ? "negotiating" : "queued";
    return `<div class="b ${i === activeIdx ? "active" : ""} ${r ? "done" : ""}">
      <span class="av">${esc(b.name[0])}</span>
      <span class="nm">${esc(b.name)}</span>
      <span class="st">${st}</span></div>`;
  }).join("");
}

const shortOutcome = (o) => ({ PAID: "rescued", DIRECT_PAID: "paid", ABORTED: "no deal",
  PAUSED_FOR_HUMAN: "handed back" }[o] || o);

/* ---------- driving the real API ---------- */

/* Read a JSON response without assuming there is one. An empty or HTML body — a crashed
 * worker, a proxy error page — otherwise surfaces as "Unexpected end of JSON input", which
 * says nothing about what actually went wrong. */
async function readJson(res, label) {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`${label}: server returned an empty body (HTTP ${res.status})` +
      (res.status >= 500 ? " — the request failed server-side; check the service logs" : ""));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: HTTP ${res.status}, response was not JSON — ` +
      text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160));
  }
}

async function csrf() {
  const r = await fetch("/api/csrf-token");
  const data = await readJson(r, "csrf-token");
  return data.csrfToken;
}

async function runBuyer(b) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await csrf();
    const res = await fetch("/api/session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentText: b.intent, skus: [{ sku: b.sku, qty: 1 }],
        userId: b.userId, csrfToken: token }),
    });
    if (res.status === 429) { await sleep(1500); continue; }   // token bucket refills at 1/s
    const data = await readJson(res, b.name);
    if (!res.ok) {
      const detail = [data.error, data.detail].filter(Boolean).join(" — ");
      throw new Error(detail || ("HTTP " + res.status));
    }
    return data;
  }
  throw new Error("rate limited — wait a moment and run again");
}

/* ---------- turning audit events into beats ---------- */

function findEvent(events, kind) { return events.find((e) => e.kind === kind); }

/* Why a waterfall step produced no candidate. Derived from live state, not from the ledger,
 * so it is phrased as an observation about availability rather than a gate verdict. */
function skipReason(step, gapPaise, cartTotalPaise) {
  if (step === "funded_campaign") {
    // Distinguish "too small to help" from "would have covered it, but the budget is gone" —
    // the second is the whole point of running several buyers against one campaign pool.
    const bigEnough = state.campaigns.filter(
      (c) => c.flatOffPaise >= gapPaise && cartTotalPaise >= c.minCartPaise);
    const broke = bigEnough.filter((c) => c.remainingBudgetPaise < c.flatOffPaise);
    if (bigEnough.length > 0 && broke.length === bigEnough.length) {
      return broke.map((c) => c.label).join(", ") +
        " would have covered this, but the budget is spent.";
    }
    return "No active campaign is both large enough and still funded.";
  }
  if (step === "rail_offer") return "No bank or network offer on the allowed rails covers the gap.";
  if (step === "bundle_swap") return "No comparable cheaper item to swap to.";
  return "No candidate available.";
}

function buildBeats(buyer, data) {
  const be = data.buyerEvents || [], me = data.merchantEvents || [];
  const beats = [];
  const product = state.bySku[buyer.sku];
  const push = (cls, ttl, dsc) => beats.push({ cls, ttl, dsc });

  push("", `${buyer.name} arrives`,
    `Cart: ${product ? esc(product.title) : buyer.sku} &middot; ${product ? rs(product.pricePaise) : ""}`);

  const mb = findEvent(be, "MANDATE_BOUND");
  if (mb) {
    const flex = mb.event.flexRule;
    push("gate", "Mandate bound",
      `Hard cap ${rs(mb.event.capPaise)}${flex ? ` &middot; may stretch ${rs(flex.maxStretchPaise)} only on a strong match` : ""}
       &middot; read by ${data.parsedBy === "llm" ? "LLM, schema-validated" : "deterministic parser"}`);
  }
  const cc = findEvent(be, "CART_CONSENT");
  if (cc) push("", "Cart consented",
    `Hashed at consent &middot; <span class="mono">${esc(String(cc.event.cartHash).slice(0, 16))}&hellip;</span>`);

  const blocked = findEvent(be, "INTENT_BLOCKED");
  const rescue = findEvent(me, "RESCUE_REQUEST");
  if (blocked) {
    push("fail", "Over budget — agent stops",
      `Cart ${rs(blocked.event.totalPaise)} exceeds the cap by <b>${rs(blocked.event.gapPaise)}</b>.
       The agent cannot authorise this on its own.`);
  }
  if (rescue) push("gate", "Merchant asked to close the gap",
    `Needs ${rs(rescue.event.requiredDiscountPaise)} to make this sale happen.`);

  const offEv = findEvent(me, "OFFER_RELEASED") || findEvent(me, "NO_OFFER");
  if (offEv) {
    const attempts = offEv.event.waterfallAttempts || [];
    const isPartial = /^Partial rescue/.test(offEv.event.offer?.explanation || "");

    // A step that produces no candidate at all is skipped by the engine without recording an
    // attempt — so an exhausted campaign leaves no trace in the event log. Reconstruct those
    // gaps from the policy order and the live budgets, or the fall-through is invisible.
    const enabled = (state.policy?.waterfall || []).filter((w) => w.enabled).map((w) => w.step);
    const tried = new Set(attempts.map((x) => x.step));
    const chosen = offEv.event.offer?.mechanism?.step;
    const reachedIdx = chosen ? enabled.indexOf(chosen) : enabled.length - 1;
    enabled.slice(0, Math.max(0, reachedIdx)).forEach((step) => {
      if (tried.has(step)) return;
      push("", MECH[step]?.label + " — skipped",
        skipReason(step, rescue?.event?.requiredDiscountPaise ?? 0,
          rescue?.event?.cartTotalPaise ?? 0));
    });

    let seenPass = false;
    attempts.forEach((a, i) => {
      const m = MECH[a.step] || { label: a.step };
      const pass = a.verdict === "PASS";
      // The engine re-runs the waterfall at half the gap when the full ask fails; the
      // second sweep is the partial rescue, so label it rather than showing a dupe.
      const retry = seenPass === false && i > 0 && attempts.slice(0, i).some((x) => x.step === a.step);
      if (pass) seenPass = true;
      push(pass ? "pass" : "fail",
        `${retry ? "Partial rescue — " : ""}${m.label}`,
        `Merchant gate: <span class="verdict ${pass ? "PASS" : "REJECT"}">${esc(a.verdict)}</span>
         ${a.verdict === "REJECT_FLOOR" ? `&mdash; would break the ${state.policy?.floorMarginPct}% margin floor`
           : a.verdict === "REJECT_BUDGET" ? "&mdash; daily discount budget is spent"
           : a.verdict === "REJECT_COOLDOWN" ? "&mdash; this buyer was already given a discount recently"
           : ""}`);
    });

    const offer = offEv.event.offer;
    if (offer) {
      const m = MECH[offer.mechanism.step];
      push("money", `Offer released — ${m.label}`,
        `New total <b>${rs(offer.newTotalPaise)}</b> &middot; paid for by ${FUNDER[offer.fundedBy] || offer.fundedBy}
         &middot; costs the merchant <b>${rs(offer.merchantCostPaise)}</b>${isPartial ? " &middot; partial rescue" : ""}`);
    } else {
      push("fail", "No offer made",
        "Every funding source was exhausted or refused by the gate. The merchant stops rather than sell at a loss.");
    }
  }

  for (const k of ["CROSS_SELL_OFFERED", "CROSS_SELL_ACCEPTED", "CROSS_SELL_DECLINED"]) {
    const ev = findEvent(be, k);
    if (!ev) continue;
    if (k === "CROSS_SELL_OFFERED") push("", "Attachment suggested", esc(ev.event.title || ev.event.sku));
    if (k === "CROSS_SELL_ACCEPTED") push("money", "Attachment accepted",
      `Within the cap &middot; new total <b>${rs(ev.event.newTotalPaise)}</b> &middot; buyer had declared this rule up front`);
    if (k === "CROSS_SELL_DECLINED") push("", "Attachment declined", esc(ev.event.reason));
  }

  const oe = findEvent(be, "OFFER_EVALUATED");
  if (oe) push(oe.event.accepted ? "pass" : "fail",
    oe.event.accepted ? "Buyer gate accepts" : "Buyer gate refuses",
    `<span class="verdict ${oe.event.accepted ? "PASS" : "REJECT"}">${esc(oe.event.trace?.verdict || "")}</span>
     ${esc(oe.event.narration || "")}`);

  for (const ev of be.filter((e) => e.kind === "PAYMENT_ATTEMPT")) {
    push(ev.event.ok ? "pass" : "fail",
      `Payment via ${String(ev.event.rail || "").toUpperCase()}`,
      ev.event.ok ? `Captured &middot; ${esc(ev.event.executor)} executor${ev.event.razorpayOrderId
        ? ` &middot; <span class="mono">${esc(ev.event.razorpayOrderId)}</span>` : ""}`
        : `Declined (${esc(ev.event.errorCode || "unknown")}) &middot; trying the next allowed rail`);
  }

  const led = findEvent(me, "DISCOUNT_LEDGERED");
  if (led) push("money", "Discount charged to the daily budget",
    `${rs(led.event.cost)} recorded against today&rsquo;s release budget.`);

  return beats;
}

/* ---------- replay ---------- */

function renderBuyerHead(buyer, data) {
  const _as = document.getElementById("advance-slot");
  if (_as) _as.innerHTML = "";
  $("#focus").scrollTop = 0;
  const product = state.bySku[buyer.sku];
  const chips = [`<span class="chip">Cap ${rs(data.capPaise)}</span>`];
  if (product) chips.push(`<span class="chip">${esc(product.title)} &middot; ${rs(product.pricePaise)}</span>`);
  chips.push(`<span class="chip">${data.parsedBy === "llm" ? "LLM parsed" : "deterministic parse"}</span>`);
  if (data.verified) chips.push(`<span class="chip ok"><i></i>ledger chain verified</span>`);
  $("#focus").innerHTML = `
    <div class="buyer-head">
      <div class="av-lg">${esc(buyer.name[0])}</div>
      <div style="flex:1">
        <div class="buyer-name">${esc(buyer.name)}</div>
        <div class="buyer-intent">&ldquo;${esc(buyer.intent)}&rdquo;</div>
        <div class="chips">${chips.join("")}</div>
      </div>
    </div>
    <div class="beats" id="beats"></div>
    <div id="outcome"></div>`;
}

function applyDrain(data) {
  const me = data.merchantEvents || [];
  const off = findEvent(me, "OFFER_RELEASED");
  const step = off?.event?.offer?.mechanism;
  if (step?.step === "funded_campaign") {
    const c = state.campaigns.find((x) => x.campaignId === step.campaignId);
    if (c) c.remainingBudgetPaise = Math.max(0, c.remainingBudgetPaise - c.flatOffPaise);
  }
  const led = findEvent(me, "DISCOUNT_LEDGERED");
  if (led) state.dailySpent += led.event.cost || 0;
  renderMeters();
}

function highlightStep(step) {
  document.querySelectorAll(".wf-step").forEach((el) =>
    el.classList.toggle("firing", el.dataset.step === step));
}

async function replay(buyer, data, pace) {
  renderBuyerHead(buyer, data);
  const beats = buildBeats(buyer, data);
  const host = $("#beats");
  for (const b of beats) {
    const div = document.createElement("div");
    div.className = "beat " + b.cls;
    div.innerHTML = `<div class="gut"><span class="pip"></span><span class="ln"></span></div>
      <div class="body"><div class="ttl">${b.ttl}</div><div class="dsc">${b.dsc}</div></div>`;
    host.appendChild(div);
    // Scroll the frame, not the document: appending a beat must never move the page.
    const frame = $("#focus");
    frame.scrollTop = frame.scrollHeight;
    const stepMatch = Object.keys(MECH).find((k) => b.ttl.includes(MECH[k].label));
    if (stepMatch) highlightStep(stepMatch);
    await sleep(pace);
  }
  highlightStep(null);
  applyDrain(data);

  const label = { PAID: "Rescued", DIRECT_PAID: "Paid straight through",
    ABORTED: "No deal", PAUSED_FOR_HUMAN: "Handed back to the human" }[data.outcome] || data.outcome;
  const narr = findEvent(data.buyerEvents || [], "SETTLEMENT_RESULT");
  $("#outcome").innerHTML = `<div class="outcome ${data.outcome}">
    <div><div class="ot">${label}</div>
      <div class="od">${esc(narr?.event?.narration || data.reason || "")}</div></div>
    <div class="final">${data.finalTotalPaise != null ? rs(data.finalTotalPaise) : "&mdash;"}</div>
  </div>`;
  // In manual mode the advance prompt provides the beat; only pause here when playing out.
  const frame = $("#focus");
  frame.scrollTop = frame.scrollHeight;
  await sleep(state.autoRun ? pace * 2.2 : 120);
}

/* Presenter-paced by default: beats land slowly enough to talk over, and the run holds at each
 * buyer's outcome until it is advanced. "Play the rest" hands the remainder back to the clock. */
function paceFor() {
  return state.autoRun ? 260 : 700;
}

/* Resolves when the presenter advances. Returns true if they asked for the rest to play out. */
function waitForAdvance(index) {
  return new Promise((resolve) => {
    const remaining = ROSTER.length - index - 1;
    const slot = document.getElementById("advance-slot");
    const host = document.createElement("div");
    host.className = "advance";
    host.innerHTML = `
      <span class="lead">Paused &middot; buyer ${index + 1} of ${ROSTER.length}</span>
      <button class="btn" id="next-buyer">Next: ${esc(ROSTER[index + 1].name)} &rarr;</button>
      <button class="btn line" id="play-rest">Play remaining ${remaining}</button>
      <span class="adv-hint"><kbd>Space</kbd> to advance</span>`;
    slot.innerHTML = "";
    slot.appendChild(host);

    const done = (auto) => {
      document.removeEventListener("keydown", onKey);
      slot.innerHTML = "";
      state.autoRun = auto;
      resolve();
    };
    const onKey = (e) => {
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); done(false); }
    };
    host.querySelector("#next-buyer").addEventListener("click", () => done(false));
    host.querySelector("#play-rest").addEventListener("click", () => done(true));
    document.addEventListener("keydown", onKey);
    host.querySelector("#next-buyer").focus();
  });
}

async function run() {
  for (const id of ["run", "run-hero", "run-foot"]) {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  }
  $("#idle")?.remove();
  state.results = [];
  state.autoRun = false;

  const queue = [];
  let failed = null;
  // Producer: strictly sequential, because campaign depletion depends on arrival order.
  const producer = (async () => {
    for (const b of ROSTER) {
      try { queue.push(await runBuyer(b)); }
      catch (e) { failed = e; queue.push(null); }
    }
  })();

  for (let i = 0; i < ROSTER.length; i++) {
    renderRoster(i);
    $("#speed").textContent = state.autoRun
      ? "playing out"
      : `buyer ${i + 1} of ${ROSTER.length}`;
    while (queue.length <= i && !failed) await sleep(120);
    const data = queue[i];
    if (!data) {
      $("#focus").innerHTML = `<div class="idle"><div><h3>Run stopped</h3>
        <p>${esc(failed?.message || "The session request failed.")}</p></div></div>`;
      for (const id of ["run", "run-hero", "run-foot"]) {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
      }
      return;
    }
    // Carry the roster entry so the analytics view can price profit against unit cost.
    state.results[i] = { ...data, _buyer: ROSTER[i] };
    await replay(ROSTER[i], data, paceFor());
    renderRoster(i);
    if (!state.autoRun && i < ROSTER.length - 1) {
      await waitForAdvance(i);
    }
  }
  await producer;
  renderRoster(-1);
  $("#speed").textContent = "";
  showReport();
}

/* ---------- report ---------- */

function showReport() {
  window.__settleState = state;
  if (window.renderReport) window.renderReport(state);
}

// Three entry points (nav, hero, footer) drive the same run.
for (const id of ["run", "run-hero", "run-foot"]) {
  document.getElementById(id)?.addEventListener("click", () => {
    document.getElementById("live")?.scrollIntoView({ behavior: "smooth", block: "start" });
    run();
  });
}
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
});
if (window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.setAttribute("data-theme", "dark");

window.__settleState = state;
boot();
