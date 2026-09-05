/* Analytics view — shown full-screen once the run completes.
 *
 * Two populations are reported and never mixed: the eight sessions just executed against the
 * live database, and the seeded 120-buyer simulation. Every chart carries a single measure, so
 * money and percentages never share an axis. */

const MECH_META = {
  funded_campaign: { label: "Brand campaign", css: "--m-campaign", own: false },
  rail_offer: { label: "Bank rail offer", css: "--m-rail", own: false },
  bundle_swap: { label: "Bundle swap", css: "--m-swap", own: false },
  price_cut: { label: "Direct price cut", css: "--m-cut", own: true },
};
const ARM_LABEL = { no_rescue: "No rescue", flat_10_pct: "Blanket 10% off", settle: "Settle" };
const OUTCOME_LABEL = { PAID: "Rescued", DIRECT_PAID: "Paid directly",
  ABORTED: "No deal", PAUSED_FOR_HUMAN: "Handed back" };

const esc2 = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (p) => "₹" + Number(Math.round(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/* Per-session economics. Cost basis comes from the catalog, so profit is real, not modelled. */
function perBuyer(state) {
  return state.results.filter(Boolean).map((r) => {
    const b = r._buyer || {};
    const product = state.bySku[b.sku];
    const me = r.merchantEvents || [];
    const offer = me.find((e) => e.kind === "OFFER_RELEASED")?.event?.offer || null;
    const ledgered = me.find((e) => e.kind === "DISCOUNT_LEDGERED")?.event?.cost || 0;
    const attached = me.find((e) => e.kind === "CROSS_SELL_ACCEPTED")?.event?.incrementalRevenuePaise || 0;
    const closed = r.outcome === "PAID" || r.outcome === "DIRECT_PAID";
    const revenue = closed ? (r.finalTotalPaise || 0) : 0;
    const cost = closed ? (product?.costPaise || 0) : 0;
    return {
      name: b.name || r.sessionId, outcome: r.outcome, closed,
      title: product?.title || b.sku || "—",
      listPaise: product?.pricePaise || 0,
      revenue, cost, attached,
      profit: closed ? revenue - cost : 0,
      ownCost: ledgered,
      step: offer?.mechanism?.step || null,
      lostPaise: closed ? 0 : (product?.pricePaise || 0),
    };
  });
}

function tile(value, label, note) {
  return `<div class="fig"><div class="v">${value}</div>
    <div class="l">${label}${note ? " &middot; " + note : ""}</div></div>`;
}

/* Horizontal bars. One measure, direct-labelled, so identity never rests on colour alone. */
function barChart(rows) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return `<div class="chart">
    ${rows.map((r) => `
      <div class="row" tabindex="0" data-tip="${esc2(r.tip || r.label + ": " + r.display)}">
        <div class="rl">${esc2(r.label)}</div>
        <div class="rt"><div class="rb" style="width:${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%;
          background:var(${r.css || "--m-campaign"})"></div></div>
        <div class="rv">${esc2(r.display)}</div>
      </div>`).join("")}
  </div>`;
}

function table(headers, rows) {
  return `<details class="tbl"><summary>Table view</summary><table>
    <thead><tr>${headers.map((h) => `<th>${esc2(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc2(c)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></details>`;
}

function panel(title, sub, body) {
  return `<div class="an-card"><h3>${esc2(title)}</h3>
    <p class="sub">${esc2(sub)}</p>${body}</div>`;
}

window.renderReport = function renderReport(state) {
  const rows = perBuyer(state);
  const closed = rows.filter((r) => r.closed);
  const rescued = rows.filter((r) => r.outcome === "PAID");
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  const ownCost = rows.reduce((s, r) => s + r.ownCost, 0);
  const attached = rows.reduce((s, r) => s + r.attached, 0);
  const lost = rows.reduce((s, r) => s + r.lostPaise, 0);
  const externallyFunded = rescued.filter((r) => r.step && !MECH_META[r.step]?.own).length;
  const convPct = rows.length ? Math.round((closed.length / rows.length) * 1000) / 10 : 0;
  const marginPct = revenue ? Math.round((profit / revenue) * 1000) / 10 : 0;

  const revRows = rows.map((r) => ({
    label: r.name, value: r.revenue,
    display: r.closed ? money(r.revenue) : (OUTCOME_LABEL[r.outcome] || r.outcome),
    css: r.step ? MECH_META[r.step]?.css : "--m-swap",
    tip: `${r.name} — ${r.title}. ` + (r.closed
      ? `Closed at ${money(r.revenue)} via ${MECH_META[r.step]?.label || "no rescue needed"}.`
      : `${OUTCOME_LABEL[r.outcome]}: ${money(r.listPaise)} of list price not captured.`),
  }));

  const profitRows = closed.map((r) => ({
    label: r.name, value: r.profit, display: money(r.profit),
    css: r.step && MECH_META[r.step]?.own ? "--m-cut" : "--m-swap",
    tip: `${r.name}: ${money(r.revenue)} revenue less ${money(r.cost)} unit cost = ${money(r.profit)} gross profit.`,
  }));

  const byMech = {};
  for (const r of rescued) if (r.step) byMech[r.step] = (byMech[r.step] || 0) + 1;
  const mechRows = Object.entries(byMech).sort((a, b) => b[1] - a[1]).map(([step, n]) => ({
    label: MECH_META[step]?.label || step, value: n, display: n + (n === 1 ? " sale" : " sales"),
    css: MECH_META[step]?.css,
    tip: `${MECH_META[step]?.label}: ${n} rescue(s), ` + (MECH_META[step]?.own
      ? "paid out of merchant margin" : "funded by someone other than the merchant"),
  }));

  const discountRows = [
    { label: "Externally funded", value: externallyFunded,
      display: externallyFunded + " of " + rescued.length, css: "--m-campaign",
      tip: "Brand campaigns, bank rail offers and margin-neutral swaps — none of it merchant margin." },
    { label: "Merchant margin", value: rescued.length - externallyFunded,
      display: money(ownCost), css: "--m-cut",
      tip: "Direct price cuts, charged against the daily release budget." },
  ];

  const byOutcome = {};
  for (const r of rows) byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
  const outcomeRows = Object.entries(byOutcome).map(([o, n]) => ({
    label: OUTCOME_LABEL[o] || o, value: n, display: n + " of " + rows.length,
    css: o === "ABORTED" ? "--m-rail" : o === "PAUSED_FOR_HUMAN" ? "--m-cut" : "--m-swap",
    tip: `${OUTCOME_LABEL[o] || o}: ${n} of ${rows.length} buyers.`,
  }));

  const M = window.METRICS;
  let popHtml = `<p class="sub">Run <code>npm run metrics</code> to generate the population figures.</p>`;
  if (M?.armsPrimary) {
    const mk = (key, fmt, css) => M.armsPrimary.map((r) => ({
      label: ARM_LABEL[r.arm] || r.arm, value: r[key], display: fmt(r[key]),
      css: r.arm === "settle" ? "--m-swap" : css,
      tip: `${ARM_LABEL[r.arm] || r.arm} across ${M.populationSize} shoppers: ${fmt(r[key])}`,
    }));
    popHtml = `
      <div class="an-grid3">
        ${panel("Carts closed", "Share of " + M.populationSize + " shoppers who bought.",
          barChart(mk("conversionPct", (v) => v + "%", "--m-campaign")))}
        ${panel("Discount from merchant margin", "Lower is better.",
          barChart(mk("ownCostDiscountPaise", money, "--m-cut")))}
        ${panel("Gross profit", "Revenue less unit cost across the population.",
          barChart(mk("grossProfitPaise", money, "--m-campaign")))}
      </div>
      ${table(["Approach", "Closed", "Conversion", "Revenue", "Own-cost discount", "Gross profit"],
        M.armsPrimary.map((r) => [ARM_LABEL[r.arm] || r.arm, r.closes + "/" + M.populationSize,
          r.conversionPct + "%", money(r.revenuePaise), money(r.ownCostDiscountPaise),
          money(r.grossProfitPaise)]))}
      <p class="foot2">Seeded population, seed ${M.seed}, reproducible via <code>npm run metrics</code>.
        Floor margin ${M.primaryFloorMarginPct}%. The 12%-floor run is retained in
        <code>docs/metrics-report.json</code> as an explicitly-labelled ceiling, not a headline.</p>`;
  }

  const view = document.getElementById("analytics");
  view.innerHTML = `
    <div class="an-bar">
      <div>
        <div class="kicker" style="margin-bottom:6px">Run complete &middot; ${rows.length} autonomous buyers</div>
        <h2 class="hd" style="margin:0">The ledger, <em>totalled.</em></h2>
      </div>
      <button class="btn line" id="an-back">&larr; Back to the page</button>
    </div>

    <div class="figs an-figs">
      ${tile(convPct + "%", "Carts closed", closed.length + " of " + rows.length)}
      ${tile(money(revenue), "Revenue captured", rescued.length + " rescued")}
      ${tile(money(profit), "Gross profit", marginPct + "% margin")}
      ${tile(money(ownCost), "Merchant's own money", externallyFunded + " of " + rescued.length + " funded by others")}
    </div>

    <div class="an-body">
      <div class="an-grid2">
        ${panel("Revenue by buyer",
          "Bar colour marks the funding source that closed the sale; refusals show why instead of a figure.",
          barChart(revRows) + table(["Buyer", "Item", "Outcome", "Revenue", "Funding"],
            rows.map((r) => [r.name, r.title, OUTCOME_LABEL[r.outcome] || r.outcome,
              r.closed ? money(r.revenue) : "—", r.step ? MECH_META[r.step].label : "—"])))}
        ${panel("Gross profit by buyer",
          "Revenue less real unit cost from the catalog. Attachment margin is excluded — its cost is not tracked separately.",
          barChart(profitRows) + table(["Buyer", "Revenue", "Unit cost", "Gross profit"],
            closed.map((r) => [r.name, money(r.revenue), money(r.cost), money(r.profit)])))}
      </div>

      <div class="an-grid3">
        ${panel("Who paid for the rescues", "The waterfall spends other people's budget first.",
          mechRows.length ? barChart(mechRows) : `<p class="sub">No rescues in this run.</p>`)}
        ${panel("Whose money closed the gap", "Only the last waterfall step touches merchant margin.",
          barChart(discountRows))}
        ${panel("Outcome mix", "Refusals are the gates holding, not failures.",
          barChart(outcomeRows))}
      </div>

      <div class="an-note">
        <div><span class="k">Revenue not captured</span><span class="v">${money(lost)}</span></div>
        <div><span class="k">Attachment revenue</span><span class="v">${money(attached)}</span></div>
        <div><span class="k">Own-cost as share of revenue</span><span class="v">${
          revenue ? (Math.round((ownCost / revenue) * 1000) / 10) : 0}%</span></div>
        <div><span class="k">Audit chains verified</span><span class="v">${
          state.results.filter((r) => r && r.verified).length}/${rows.length}</span></div>
      </div>

      <h2 class="hd" style="margin:36px 0 4px">At population scale</h2>
      <p class="sub" style="margin-bottom:16px">A separate seeded simulation — not the ${rows.length} sessions above.</p>
      ${popHtml}
    </div>
    <div id="tip" class="tip"></div>`;

  document.body.classList.add("analytics-open");
  view.scrollTop = 0;

  document.getElementById("an-back").addEventListener("click", () => {
    document.body.classList.remove("analytics-open");
    view.innerHTML = "";
    document.getElementById("live")?.scrollIntoView({ block: "start" });
  });

  const tip = view.querySelector("#tip");
  view.querySelectorAll("[data-tip]").forEach((el) => {
    const show = () => {
      tip.textContent = el.dataset.tip;
      tip.style.opacity = "1";
      const r = el.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 270, Math.max(8, r.left)) + "px";
      tip.style.top = Math.max(8, r.top - 36) + "px";
    };
    el.addEventListener("mouseenter", show);
    el.addEventListener("focus", show);
    el.addEventListener("mouseleave", () => (tip.style.opacity = "0"));
    el.addEventListener("blur", () => (tip.style.opacity = "0"));
  });
};
