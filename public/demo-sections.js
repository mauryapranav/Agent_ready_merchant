/* Narrative sections around the live run. Everything shares one visual unit — a ruled row with
 * a label on the left and a monospace figure on the right — so the hero, the waterfall, the
 * comparison and the metrics all read as parts of the same ledger rather than separate widgets. */

const q = (s) => document.querySelector(s);
const escH = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (p) => "₹" + Number(Math.round(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const STAGES = [
  { step: "funded_campaign", label: "Brand campaign", css: "--m-campaign", short: "₹0",
    who: "Paid for by the brand", cost: 0,
    blurb: `An active, brand-funded campaign large enough to close the gap is applied first. The
      merchant contributes nothing — the budget belongs to somebody else, and it depletes as it is
      drawn on. When it runs dry the waterfall moves down a step rather than inventing money.`,
    kv: [["Merchant cost", "₹0"], ["Funding source", "Brand marketing"],
      ["Depletes", "Yes, shared"], ["Gate effect", "Floor unaffected"]] },
  { step: "rail_offer", label: "Bank rail offer", css: "--m-rail", short: "₹0",
    who: "Paid for by a bank or card network", cost: 0,
    blurb: `Card and UPI offers are underwritten by banks and networks, not the merchant. Settle
      only proposes a rail the buyer's mandate actually permits, so a discount never arrives
      attached to a payment method they refused.`,
    kv: [["Merchant cost", "₹0"], ["Funding source", "Bank / network"],
      ["Constraint", "Allowed rails only"], ["Gate effect", "Floor unaffected"]] },
  { step: "bundle_swap", label: "Bundle swap", css: "--m-swap", short: "~₹0",
    who: "Costs nobody — a cheaper equivalent", cost: 15,
    blurb: `Rather than discount the item, offer a comparable one already inside the budget. Margin
      is usually preserved or improved, and the buyer's own gate decides whether the substitute is
      acceptable against their stated preferences.`,
    kv: [["Merchant cost", "Usually ₹0"], ["Funding source", "None — different SKU"],
      ["Constraint", "Buyer must accept"], ["Gate effect", "Margin recalculated"]] },
  { step: "price_cut", label: "Direct price cut", css: "--m-cut", short: "full",
    who: "Paid for by the merchant", cost: 100,
    blurb: `The last resort, and the only step that spends the merchant's own margin. Sized to the
      minimum that closes the gap, charged against a daily release budget, and refused outright if
      it would drop the sale below the floor.`,
    kv: [["Merchant cost", "The full discount"], ["Funding source", "Merchant margin"],
      ["Constraint", "Daily budget + cooldown"], ["Gate effect", "REJECT_FLOOR if under"]] },
];

/* ---------------- hero policy ledger + figures ---------------- */

async function heroLedger() {
  try {
    const res = await fetch("/api/catalog");
    const d = await res.json();
    const p = d.policy;
    if (p) {
      q("#hp-floor").textContent = p.floorMarginPct + "%";
      q("#hp-budget").textContent = inr(p.dailyReleaseBudgetPaise) + " / day";
      q("#hp-cool").textContent = p.cooldownMinutes + " min";
    }
    q("#hp-waterfall").innerHTML = STAGES.map((s, i) => `
      <div class="lrow step">
        <span class="k"><span class="ix">0${i + 1}</span>
          <span class="sq" style="background:var(${s.css})"></span>${escH(s.label)}</span>
        <span class="v">${escH(s.short)}</span>
      </div>`).join("");
  } catch { /* the live section reports connection problems already */ }
}

function heroFigures() {
  const M = window.METRICS;
  if (!M?.armsPrimary) return;
  const settle = M.armsPrimary.find((a) => a.arm === "settle");
  const flat = M.armsPrimary.find((a) => a.arm === "flat_10_pct");
  if (settle) {
    q("#hs-conv").textContent = settle.conversionPct + "%";
    q("#hs-own").textContent = inr(settle.ownCostDiscountPaise);
  }
  if (settle && flat && flat.ownCostDiscountPaise > 0) {
    q("#hs-vs").textContent =
      Math.round((1 - settle.ownCostDiscountPaise / flat.ownCostDiscountPaise) * 100) + "%";
  }
}

/* ---------------- waterfall: all four stages side by side ---------------- */

/* Rendered as parallel columns rather than a tab strip: the order IS the argument, so every
 * stage and its merchant cost has to be readable at once, without a click. */
function renderPipeline() {
  document.getElementById("pipe-grid").innerHTML = STAGES.map((s, i) => `
    <div class="wf-col" style="--stage:var(${s.css})">
      <div class="top">
        <div class="ix"><span class="sq"></span>STAGE 0${i + 1}</div>
        <h3>${escH(s.label)}</h3>
        <div class="who">${escH(s.who)}</div>
      </div>
      <p>${s.blurb}</p>
      <div class="costbar"><i style="width:${Math.max(3, s.cost)}%"></i></div>
      <div class="kvs">
        ${s.kv.map(([k, v]) => `<div class="kv"><span>${escH(k)}</span>
          <span>${escH(v)}</span></div>`).join("")}
      </div>
    </div>`).join("");
}
/* ---------------- arm comparison as ledger rows ---------------- */

const ARMS = {
  no_rescue: ["Baseline", "Over-budget carts are simply lost"],
  flat_10_pct: ["Blanket 10% off", "Converts, but every rupee is merchant margin"],
  settle: ["Settle", "External funding first, own margin last"],
};

function renderArms() {
  const M = window.METRICS;
  if (!M?.armsPrimary) {
    q("#arms").innerHTML = `<p class="lede">Run <code>npm run metrics</code> to generate these figures.</p>`;
    return;
  }
  q("#arms").innerHTML = `
    <div class="hrow"><span>Approach</span><span style="text-align:right">Closed</span>
      <span style="text-align:right">Conversion</span><span style="text-align:right">Own-cost discount</span>
      <span style="text-align:right">Gross profit</span></div>
    ${M.armsPrimary.map((r) => {
      const [nm, note] = ARMS[r.arm] || [r.arm, ""];
      return `<div class="drow ${r.arm === "settle" ? "win" : ""}">
        <div class="nm">${escH(nm)}<small>${escH(note)}</small></div>
        <div class="cell">${r.closes}/${M.populationSize}</div>
        <div class="cell big">${r.conversionPct}%</div>
        <div class="cell">${inr(r.ownCostDiscountPaise)}</div>
        <div class="cell">${inr(r.grossProfitPaise)}</div>
      </div>`;
    }).join("")}`;
}

/* ---------------- shared session helpers ---------------- */

async function readJsonSafe(res, label) {
  const text = await res.text();
  if (!text.trim()) throw new Error(`${label}: empty response (HTTP ${res.status})`);
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}: HTTP ${res.status} — ${text.replace(/<[^>]*>/g, " ").slice(0, 140)}`); }
}

async function postSession(body, label) {
  const t = await readJsonSafe(await fetch("/api/csrf-token"), "csrf");
  const res = await fetch("/api/session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, csrfToken: t.csrfToken }),
  });
  const data = await readJsonSafe(res, label);
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" — ") || ("HTTP " + res.status));
  return data;
}

function outcomeBlock(d) {
  const label = { PAID: "Rescued", DIRECT_PAID: "Paid straight through",
    ABORTED: "No deal", PAUSED_FOR_HUMAN: "Handed back to a human" }[d.outcome] || d.outcome;
  const narr = (d.buyerEvents || []).find((e) => e.kind === "SETTLEMENT_RESULT");
  const ev = (d.merchantEvents || []).find((e) => e.kind === "OFFER_RELEASED" || e.kind === "NO_OFFER");
  const trace = (ev?.event?.waterfallAttempts || [])
    .map((a) => `${a.step} <span class="verdict ${a.verdict === "PASS" ? "PASS" : "REJECT"}">${escH(a.verdict)}</span>`)
    .join(" &rarr; ");
  return `<div class="outcome ${d.outcome}">
      <div><div class="ot">${label}</div>
        <div class="od">${escH(narr?.event?.narration || d.reason || "")}</div></div>
      <div class="final">${d.finalTotalPaise != null ? inr(d.finalTotalPaise) : "&mdash;"}</div>
    </div>
    ${trace ? `<div style="font-size:12px;color:var(--muted);margin-top:10px;
      font-family:ui-monospace,monospace">${trace}</div>` : ""}
    <div class="chips" style="margin-top:10px">
      <span class="chip">${d.parsedBy === "llm" ? "LLM parsed" : "deterministic parse"}</span>
      ${d.verified ? `<span class="chip ok"><i></i>ledger verified</span>`
        : `<span class="chip bad"><i></i>chain broken</span>`}
      ${d.paidVia ? `<span class="chip">paid via ${escH(d.paidVia)}</span>` : ""}
    </div>`;
}

/* ---------------- try it yourself ---------------- */

let catalogCache = [];

async function loadCatalogInto() {
  const data = await readJsonSafe(await fetch("/api/catalog"), "catalog");
  catalogCache = data.catalog || [];
  q("#sku-list").innerHTML = catalogCache.map((p) => `
    <label><input type="checkbox" name="try-sku" value="${escH(p.sku)}">
      <span>${escH(p.title)}</span>
      <span class="mono" style="color:var(--muted);margin-left:auto">${inr(p.pricePaise)}</span></label>`).join("");
}

/* Tiered: a stated brand or category outranks price, which only breaks ties. */
function autoSelect(parsed) {
  const list = q("#sku-list");
  list.querySelectorAll('input[name="try-sku"]').forEach((i) => {
    i.checked = false;
    i.parentElement.querySelector(".sku-auto")?.remove();
  });
  const cap = parsed.capPaise;
  const wantBrand = parsed.softCriteria?.find((c) => c.kind === "brand")?.value?.toLowerCase();
  const wantCat = parsed.softCriteria?.find((c) => c.kind === "category")?.value?.toLowerCase();
  const scored = catalogCache
    .filter((p) => p.pricePaise <= cap)
    .map((p) => ({ p,
      brand: wantBrand && p.brand.toLowerCase() === wantBrand ? 1 : 0,
      cat: wantCat && p.category.toLowerCase() === wantCat ? 1 : 0 }))
    .sort((a, b) => (b.brand - a.brand) || (b.cat - a.cat) || (a.p.pricePaise - b.p.pricePaise));

  const best = scored[0];
  if (!best) {
    const cheapest = catalogCache.slice().sort((a, b) => a.pricePaise - b.pricePaise)[0];
    q("#try-note").innerHTML = `Nothing in the catalog fits a ${inr(cap)} cap` +
      (cheapest ? ` — the cheapest item is ${escH(cheapest.title)} at ${inr(cheapest.pricePaise)}.` : ".") +
      ` Raise the cap or tick something manually.`;
    return;
  }
  const input = list.querySelector(`input[value="${best.p.sku}"]`);
  if (input) {
    input.checked = true;
    const b = document.createElement("span");
    b.className = "sku-auto"; b.textContent = "auto";
    input.parentElement.appendChild(b);
  }
  q("#try-note").innerHTML = (wantBrand && !best.brand) || (wantCat && !best.cat)
    ? "No item matched every stated preference within the cap — picked the closest affordable option."
    : "";
}

async function tryParse() {
  const btn = q("#try-parse");
  btn.disabled = true;
  try {
    const t = await readJsonSafe(await fetch("/api/csrf-token"), "csrf");
    const res = await fetch("/api/parse", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentText: q("#try-intent").value, csrfToken: t.csrfToken }),
    });
    const d = await readJsonSafe(res, "parse");
    if (!res.ok) { q("#try-chips").innerHTML = `<span class="chip bad"><i></i>${escH(d.error)}</span>`; return; }
    const bits = [`Cap ${inr(d.capPaise)}`];
    if (d.maxStretchPaise != null) bits.push(`May stretch ${inr(d.maxStretchPaise)} on a strong match`);
    for (const c of d.softCriteria ?? []) bits.push(`Prefers ${c.value}`);
    for (const c of d.attachmentCriteria ?? []) bits.push(`Extras only from ${c.value}`);
    bits.push(`Rails: ${(d.allowedRails ?? []).join(", ")}`);
    q("#try-chips").innerHTML = bits.map((b) => `<span class="chip">${escH(b)}</span>`).join("") +
      `<span class="chip">${d.parsedBy === "llm" ? "read by LLM, schema-validated" : "read by deterministic parser"}</span>`;
    autoSelect(d);
  } catch (e) {
    q("#try-chips").innerHTML = `<span class="chip bad"><i></i>${escH(e.message)}</span>`;
  } finally { btn.disabled = false; }
}

async function tryRun() {
  const btn = q("#try-run");
  const skus = [...document.querySelectorAll('#sku-list input[name="try-sku"]:checked')]
    .map((i) => ({ sku: i.value, qty: 1 }));
  if (!skus.length) {
    q("#try-result").innerHTML = `<div class="outcome ABORTED"><div><div class="ot">Pick an item first</div>
      <div class="od">Read the intent to auto-select, or tick something in the cart.</div></div></div>`;
    return;
  }
  btn.disabled = true;
  q("#try-beats").innerHTML = "";
  q("#try-result").innerHTML = `<p style="font-size:13px;color:var(--muted)">Negotiating…</p>`;
  try {
    const d = await postSession({ intentText: q("#try-intent").value, skus }, "your session");
    q("#try-result").innerHTML = "";
    // Same beat builder the scripted run uses, so this shows the whole process, not just a verdict.
    if (window.renderSessionBeats) {
      await window.renderSessionBeats(
        { name: "You", sku: skus[0].sku, intent: q("#try-intent").value },
        d, q("#try-beats"), 320);
    }
    q("#try-result").innerHTML = outcomeBlock(d);
    window.refreshHistory?.();
  } catch (e) {
    q("#try-result").innerHTML = `<div class="outcome ABORTED"><div><div class="ot">Run failed</div>
      <div class="od">${escH(e.message)}</div></div></div>`;
  } finally { btn.disabled = false; }
}

/* ---------------- adversarial scenarios ---------------- */

const SCENARIOS = [
  { n: "UPI rail fails, card succeeds", intent: "Get me running shoes under 5000",
    skus: [{ sku: "nike-peg-41", qty: 1 }], failRails: ["upi"], expect: "paid via another rail" },
  { n: "Every rail declines", intent: "Get me running shoes under 5000",
    skus: [{ sku: "nike-peg-41", qty: 1 }], failRails: ["upi", "card", "netbanking", "wallet"],
    expect: "bounded retries, abort" },
  { n: "Offer expires instantly", intent: "Get me running shoes under 3700",
    skus: [{ sku: "nike-peg-41", qty: 1 }], offerTtlMs: 0, expect: "offer expired" },
  { n: "Cart tampered after consent", intent: "Get me running shoes under 5000",
    skus: [{ sku: "nike-peg-41", qty: 1 }], forceDrift: true, expect: "cart drift" },
  { n: "Floor margin holds", intent: "Get me running shoes under 3000",
    skus: [{ sku: "nike-peg-41", qty: 1 }], policyOverrides: { floorMarginPct: 30 },
    expect: "would breach floor" },
  { n: "Daily discount budget exhausted", intent: "Get me running shoes under 3700",
    skus: [{ sku: "nike-peg-41", qty: 1 }], policyOverrides: { dailyReleaseBudgetPaise: 1 },
    expect: "budget spent" },
  { n: "Campaigns off, own money only", intent: "Get me running shoes under 3700",
    skus: [{ sku: "nike-peg-41", qty: 1 }], waterfallDisabled: ["funded_campaign", "rail_offer"],
    expect: "swap or price cut" },
  { n: "Attachment respects the buyer's rule", intent: "Get me these under 5000. Extras only from Jockey.",
    skus: [{ sku: "nike-peg-41", qty: 1 }], expect: "Jockey attachment" },
];

function renderScenarios() {
  q("#scn-list").innerHTML = SCENARIOS.map((s, i) => `
    <div class="s" data-i="${i}"><span>${escH(s.n)}</span><span class="r">${escH(s.expect)}</span></div>`).join("");
  q("#scn-list").querySelectorAll(".s").forEach((el) =>
    el.addEventListener("click", () => runScenario(Number(el.dataset.i), el)));
}

async function runScenario(i, el) {
  const s = SCENARIOS[i];
  q("#scn-list").querySelectorAll(".s").forEach((x) => x.classList.remove("ok", "bad"));
  q("#scn-result").innerHTML = `<p style="color:var(--muted)">Running &ldquo;${escH(s.n)}&rdquo;…</p>`;
  try {
    const { n, expect, ...body } = s;
    const d = await postSession(body, s.n);
    el.classList.add(d.outcome === "ABORTED" || d.outcome === "PAUSED_FOR_HUMAN" ? "bad" : "ok");
    window.refreshHistory?.();
    q("#scn-result").innerHTML =
      `<div style="font-weight:650;margin-bottom:4px;font-family:-apple-system,sans-serif">${escH(s.n)}</div>
       <div style="font-size:12px;color:var(--muted);margin-bottom:11px">Expected: ${escH(s.expect)}</div>
       ${outcomeBlock(d)}`;
  } catch (e) {
    el.classList.add("bad");
    q("#scn-result").innerHTML = `<div class="outcome ABORTED"><div><div class="ot">Scenario failed</div>
      <div class="od">${escH(e.message)}</div></div></div>`;
  }
}

/* ---------------- init ---------------- */

heroFigures();
heroLedger();
renderPipeline();
renderArms();
renderScenarios();
loadCatalogInto().catch(() => {
  q("#sku-list").innerHTML = `<p style="font-size:12px;color:var(--muted);padding:10px">Catalog unavailable.</p>`;
});
q("#try-parse")?.addEventListener("click", tryParse);
q("#try-run")?.addEventListener("click", tryRun);

/* The analytics view is also reachable before any run: with no live sessions it shows the
 * precalculated 120-buyer simulation on its own, so the numbers are there from a cold start. */
document.getElementById("open-analytics")?.addEventListener("click", (e) => {
  e.preventDefault();
  if (window.renderReport) window.renderReport(window.__settleState || { results: [], bySku: {} });
});


/* ---------------- transaction history ---------------- */

const HIST_MECH = {
  funded_campaign: ["Brand campaign", "--m-campaign"],
  rail_offer: ["Bank rail offer", "--m-rail"],
  bundle_swap: ["Bundle swap", "--m-swap"],
  price_cut: ["Direct price cut", "--m-cut"],
};
const HIST_OUTCOME = { PAID: "Rescued", DIRECT_PAID: "Paid directly",
  ABORTED: "No deal", PAUSED_FOR_HUMAN: "Handed back" };

function itemsLabel(items) {
  if (!Array.isArray(items)) return "—";
  return items.map((i) => (catalogCache.find((p) => p.sku === i.sku)?.title || i.sku) +
    (i.qty > 1 ? " x" + i.qty : "")).join(", ");
}

async function loadHistory() {
  const body = q("#hist-body"), sum = q("#hist-sum");
  if (!body) return;
  try {
    const d = await readJsonSafe(await fetch("/api/history?limit=100"), "history");
    const rows = d.sessions || [];
    if (!rows.length) {
      body.innerHTML = `<p class="sub" style="padding:16px 2px">No sessions recorded yet.
        Run the live demo or negotiate your own mandate above.</p>`;
      sum.innerHTML = "";
      return;
    }
    const settled = (r) => r.outcome === "PAID" || r.outcome === "DIRECT_PAID";
    const closed = rows.filter(settled);
    const revenue = closed.reduce((a, r) => a + (r.finalTotalPaise || 0), 0);
    // offer_snapshot records what was OFFERED. Margin is only actually spent when the buyer
    // accepted and the charge succeeded, so a refused offer must not count against the merchant.
    const ownCost = closed.reduce((a, r) => a + (r.merchantCostPaise || 0), 0);
    sum.innerHTML = [
      ["Sessions recorded", rows.length],
      ["Settled", closed.length + " of " + rows.length],
      ["Revenue captured", inr(revenue)],
      ["Merchant's own money", inr(ownCost)],
    ].map(([k, v]) => `<div><div class="k">${escH(k)}</div><div class="v">${escH(v)}</div></div>`).join("");

    body.innerHTML = `<table>
      <thead><tr><th>When</th><th>Items</th><th>Cart</th><th>Cap</th><th>Outcome</th>
        <th>Funding</th><th>Own cost</th><th>Settled</th><th>Rail</th></tr></thead>
      <tbody>${rows.map((r) => {
        const mech = r.mechanismStep ? HIST_MECH[r.mechanismStep] : null;
        const offeredOnly = !settled(r) && r.mechanismStep;
        const when = new Date(r.at);
        return `<tr>
          <td>${when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
          <td class="wide">${escH(itemsLabel(r.items))}</td>
          <td>${inr(r.cartTotalPaise)}</td>
          <td>${inr(r.capPaise)}</td>
          <td><span class="pillo ${escH(r.outcome)}"><i></i>${escH(HIST_OUTCOME[r.outcome] || r.outcome)}</span></td>
          <td>${mech ? `<span class="mech"><span class="sq" style="background:var(${mech[1]})"></span>${escH(mech[0])}${offeredOnly ? " (offered)" : ""}</span>` : "—"}</td>
          <td>${settled(r) ? (r.merchantCostPaise ? inr(r.merchantCostPaise) : "₹0")
            : `<span style="color:var(--muted)">not spent</span>`}</td>
          <td>${r.finalTotalPaise != null ? inr(r.finalTotalPaise) : "—"}</td>
          <td>${escH(r.paidVia || "—")}</td>
        </tr>`;
      }).join("")}</tbody></table>`;
  } catch (e) {
    body.innerHTML = `<p class="sub" style="padding:16px 2px">History unavailable — ${escH(e.message)}</p>`;
  }
}

window.refreshHistory = loadHistory;
loadCatalogInto().then(loadHistory).catch(loadHistory);
