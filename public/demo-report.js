/* Metrics landing for the control room.
 *
 * Two panes, deliberately kept apart: what the judges just watched (8 live sessions against
 * the real database) and the seeded 120-buyer simulation. They are different populations and
 * different sample sizes, so they never share an axis or a chart.
 */

const MECH_META = {
  funded_campaign: { label: "Brand campaign", css: "--m-campaign", own: false },
  rail_offer: { label: "Bank rail offer", css: "--m-rail", own: false },
  bundle_swap: { label: "Bundle swap", css: "--m-swap", own: false },
  price_cut: { label: "Direct price cut", css: "--m-cut", own: true },
};
const ARM_LABEL = { no_rescue: "No rescue", flat_10_pct: "Blanket 10% off", settle: "Settle" };

const esc2 = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (p) => "₹" + Number(Math.round(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });

function liveAggregate(results) {
  const a = { n: results.length, closes: 0, rescued: 0, directPaid: 0, aborted: 0, paused: 0,
    revenuePaise: 0, ownCostPaise: 0, fundedByOthers: 0, attachedPaise: 0, mech: {} };
  for (const r of results) {
    const me = r.merchantEvents || [];
    const off = me.find((e) => e.kind === "OFFER_RELEASED")?.event?.offer;
    if (r.outcome === "PAID" || r.outcome === "DIRECT_PAID") {
      a.closes++;
      a.revenuePaise += r.finalTotalPaise || 0;
      if (r.outcome === "PAID") a.rescued++; else a.directPaid++;
    } else if (r.outcome === "ABORTED") a.aborted++;
    else if (r.outcome === "PAUSED_FOR_HUMAN") a.paused++;

    const ledgered = me.find((e) => e.kind === "DISCOUNT_LEDGERED");
    if (ledgered) a.ownCostPaise += ledgered.event.cost || 0;
    const cross = me.find((e) => e.kind === "CROSS_SELL_ACCEPTED");
    if (cross) a.attachedPaise += cross.event.incrementalRevenuePaise || 0;

    if (off && (r.outcome === "PAID")) {
      const step = off.mechanism?.step;
      a.mech[step] = (a.mech[step] || 0) + 1;
      if (!MECH_META[step]?.own) a.fundedByOthers++;
    }
  }
  a.conversionPct = a.n ? Math.round((a.closes / a.n) * 1000) / 10 : 0;
  return a;
}

/* Same cell as the hero figures band, so the run summary reads as part of the page. */
function tile(value, label, note) {
  return `<div class="fig"><div class="v">${value}</div>
    <div class="l">${label}${note ? " &middot; " + note : ""}</div></div>`;
}

/* Horizontal bars. One measure per chart, direct-labelled, so nothing depends on colour alone. */
function barChart(rows, opts) {
  const max = Math.max(...rows.map((r) => r.value), opts.min || 0) || 1;
  return `<div class="chart">
    ${rows.map((r) => `
      <div class="row" tabindex="0" data-tip="${esc2(r.tip || (r.label + ": " + r.display))}">
        <div class="rl">${esc2(r.label)}</div>
        <div class="rt"><div class="rb" style="width:${Math.max(1.5, (r.value / max) * 100)}%;
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

window.renderReport = function renderReport(state) {
  const live = liveAggregate(state.results);
  const M = window.METRICS;

  const mechRows = Object.entries(live.mech)
    .sort((a, b) => b[1] - a[1])
    .map(([step, n]) => ({
      label: MECH_META[step]?.label || step, value: n, display: n + (n === 1 ? " sale" : " sales"),
      css: MECH_META[step]?.css,
      tip: `${MECH_META[step]?.label}: ${n} rescued sale(s), ${MECH_META[step]?.own
        ? "paid out of merchant margin" : "funded by someone other than the merchant"}`,
    }));

  let popHtml = `<p class="sub">Run <code>npm run metrics</code> to generate the population figures.</p>`;
  if (M && M.armsPrimary) {
    const arms = M.armsPrimary;
    const convRows = arms.map((r) => ({
      label: ARM_LABEL[r.arm] || r.arm, value: r.conversionPct, display: r.conversionPct + "%",
      css: r.arm === "settle" ? "--m-swap" : "--m-campaign",
      tip: `${ARM_LABEL[r.arm] || r.arm}: ${r.closes} of ${M.populationSize} carts closed`,
    }));
    const costRows = arms.map((r) => ({
      label: ARM_LABEL[r.arm] || r.arm, value: r.ownCostDiscountPaise, display: money(r.ownCostDiscountPaise),
      css: r.arm === "settle" ? "--m-swap" : "--m-cut",
      tip: `${ARM_LABEL[r.arm] || r.arm}: ${money(r.ownCostDiscountPaise)} out of the merchant's own margin`,
    }));
    popHtml = `
      <div class="two">
        <div>
          <h3>Carts closed</h3>
          <p class="sub">Share of ${M.populationSize} synthetic buyers who completed a purchase.</p>
          ${barChart(convRows, {})}
        </div>
        <div>
          <h3>Discount paid from merchant margin</h3>
          <p class="sub">Lower is better — the same conversion bought with less of the merchant's own money.</p>
          ${barChart(costRows, {})}
        </div>
      </div>
      ${table(["Approach", "Closed", "Conversion", "Revenue", "Own-cost discount", "Gross profit"],
        arms.map((r) => [ARM_LABEL[r.arm] || r.arm, r.closes, r.conversionPct + "%",
          money(r.revenuePaise), money(r.ownCostDiscountPaise), money(r.grossProfitPaise)]))}
      <p class="foot">Seeded population, seed ${M.seed}, reproducible via <code>npm run metrics</code>.
         Floor margin ${M.primaryFloorMarginPct}%. The separate 12% run is retained in
         <code>docs/metrics-report.json</code> as an explicitly-labelled ceiling, not a headline.</p>`;
  }

  // The report now lives inside the evidence section rather than replacing the page, so the
  // live run stays on screen and the narrative order is preserved.
  const root = document.getElementById("report-root");
  root.innerHTML = `
  <div class="report block">
    <h3>What just happened</h3>
    <p class="sub">${live.n} autonomous buyers negotiated against a live policy, a real database
      and real payment rails. Every figure came out of the audit ledger.</p>

    <div class="figs" style="border-radius:3px">
      ${tile(live.conversionPct + "%", "Carts closed", `${live.closes} of ${live.n}`)}
      ${tile(money(live.revenuePaise), "Revenue captured",
        live.rescued + " rescued from abandonment")}
      ${tile(money(live.ownCostPaise), "Merchant's own money",
        live.fundedByOthers + " of " + live.rescued + " rescues funded by others")}
      ${tile(live.paused + live.aborted, "Refused or handed back",
        "Gates held rather than overspend")}
    </div>

    ${mechRows.length ? `
      <div class="block">
        <h3>Where the rescue money came from</h3>
        <p class="sub">The waterfall spends other people's money first. Only the last
           step touches merchant margin.</p>
        ${barChart(mechRows, {})}
        ${table(["Funding source", "Rescued sales", "Whose money"],
          Object.entries(live.mech).map(([s, n]) =>
            [MECH_META[s]?.label || s, n, MECH_META[s]?.own ? "Merchant margin" : "Brand / bank / neutral"]))}
      </div>` : ""}

    <div class="block">
      <h2>At population scale</h2>
      <p class="sub">A separate, seeded simulation — not the eight sessions above.</p>
      ${popHtml}
    </div>

  </div>`;


  // Hover/focus tooltip — bigger hit target than the mark itself.
  const tip = document.getElementById("tip");
  if (!tip) return;
  root.querySelectorAll("[data-tip]").forEach((el) => {
    const show = (e) => {
      tip.textContent = el.dataset.tip;
      tip.style.opacity = "1";
      const r = el.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 260, r.left) + "px";
      tip.style.top = (window.scrollY + r.top - 34) + "px";
    };
    el.addEventListener("mouseenter", show);
    el.addEventListener("focus", show);
    el.addEventListener("mouseleave", () => (tip.style.opacity = "0"));
    el.addEventListener("blur", () => (tip.style.opacity = "0"));
  });
};
