import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 8790;
const BASE = `http://localhost:${PORT}`;
mkdirSync("e2e-artifacts", { recursive: true });

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/api/catalog`);
      if (res.ok) return;
    } catch {}
    await wait(500);
  }
  throw new Error("Server did not become healthy");
}

const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/server/api.ts"], {
  env: { ...process.env, PORT: String(PORT), SETTLE_NO_LISTEN: "" },
  stdio: "ignore",
});

let failures = 0;

async function runScenario(page, name, fn) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await fn(page);
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
    try {
      console.log("   url:", page.url(), "| title:", await page.title().catch(() => "?"));
      console.log("   body head:", (await page.textContent("body").catch(() => "")).slice(0, 120));
    } catch {}
    await page.screenshot({ path: `e2e-artifacts/fail-${name.replace(/\s+/g, "-").toLowerCase()}.png` });
  }
  if (errors.length) {
    failures++;
    console.log(`FAIL ${name} (page errors): ${errors.join("; ")}`);
  }
}

async function runSessionViaUi(page, { intent, failUpi = false, failCard = false, sharing = null, expire = false, drift = false }) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.click('nav a[data-tab="run"]');
  await page.waitForSelector('[data-testid="intent-input"]', { state: "visible", timeout: 15000 });
  await page.fill('[data-testid="intent-input"]', intent);
  if (failUpi || failCard) {
    const boxes = page.locator('[data-testid="fail-rail"]');
    if (failUpi) await boxes.nth(0).check();
    if (failCard) await boxes.nth(1).check();
    else await boxes.nth(0).uncheck().catch(() => {});
  }
  if (sharing) await page.selectOption('[data-testid="sharing"]', sharing);
  if (expire) await page.check('[data-testid="fi-expire"]');
  if (drift) await page.check('[data-testid="fi-drift"]');
  await page.click('[data-testid="run-btn"]');
  await page.waitForSelector('[data-testid="result-banner"].ok, [data-testid="result-banner"].bad, [data-testid="result-banner"].warn', { timeout: 10000 });
  return page.textContent('[data-testid="result-banner"]');
}

async function main() {
  await waitHealthy();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await runScenario(page, "01 happy rescue", async (p) => {
    const banner = await runSessionViaUi(p, { intent: "Get me running shoes under ₹4000, can stretch by 300 if it's really Nike shoes" });
    if (!/PAID/.test(banner ?? "")) throw new Error(`expected PAID, got: ${banner}`);
    const traceText = await p.textContent('[data-testid="trace"]');
    if (!/chain verified/.test(traceText ?? "")) throw new Error("trace missing verified badge");
    if (/TAMPERED/.test(traceText ?? "")) throw new Error("trace shows TAMPERED");
    await p.screenshot({ path: "e2e-artifacts/01-happy-rescue.png" });
  });

  await runScenario(page, "02 all rails declined", async (p) => {
    const banner = await runSessionViaUi(p, { intent: "Get me running shoes under ₹5000", failUpi: true, failCard: true });
    if (!/PAYMENT_DECLINED|ABORTED/.test(banner ?? "")) throw new Error(`expected graceful abort, got: ${banner}`);
    await p.screenshot({ path: "e2e-artifacts/02-payment-declined.png" });
  });

  await runScenario(page, "03 offer expired mid-round", async (p) => {
    const banner = await runSessionViaUi(p, { intent: "Get me running shoes under ₹4000", expire: true });
    if (!/ABORTED|PAUSED/.test(banner ?? "")) throw new Error(`expected no payment on expired offer, got: ${banner}`);
    const traceText = await p.textContent('[data-testid="trace"]');
    if (!/expired/i.test(traceText ?? "")) throw new Error("narration should mention expiry");
    await p.screenshot({ path: "e2e-artifacts/03-offer-expired.png" });
  });

  await runScenario(page, "04 cart drift after consent", async (p) => {
    const banner = await runSessionViaUi(p, { intent: "Get me running shoes under ₹4000", drift: true });
    if (!/CART_DRIFT/.test(banner ?? "")) throw new Error(`expected CART_DRIFT abort, got: ${banner}`);
    await p.screenshot({ path: "e2e-artifacts/04-cart-drift.png" });
  });

  await runScenario(page, "05 consent revoked still completes", async (p) => {
    const banner = await runSessionViaUi(p, { intent: "Get me running shoes under ₹4000", sharing: "none" });
    if (!/PAID|ABORTED/.test(banner ?? "")) throw new Error(`session should complete without affinity data, got: ${banner}`);
    await p.click('nav a[data-tab="insights"]');
    await p.waitForSelector("#insights-view .insight-row, #insights-view .muted");
    await p.screenshot({ path: "e2e-artifacts/05-consent-revoked.png" });
  });

  await runScenario(page, "06 buyer page voice-fallback rescue", async (p) => {
    await p.goto(`${BASE}/buyer`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector('[data-testid="buyer-intent"]', { state: "visible", timeout: 15000 });
    const micVisible = await p.isVisible('[data-testid="mic-btn"]');
    if (!micVisible) throw new Error("mic button should exist in Chromium");
    await p.fill('[data-testid="buyer-intent"]', "Get me running shoes under ₹4000. Extras only from Jockey.");
    await p.click('[data-testid="parse-btn"]');
    await p.waitForSelector('[data-testid="intent-chips"]:not(.hidden)', { timeout: 10000 });
    const chips = await p.textContent('[data-testid="intent-chips"]');
    if (!/Cap ₹4,000/.test(chips ?? "")) throw new Error(`cap chip missing, got: ${chips}`);
    if (!/deterministic parser|LLM · validated/.test(chips ?? "")) throw new Error("parser badge missing on chips");
    await p.click('[data-testid="run-btn"]');
    await p.waitForSelector('[data-testid="buyer-banner"].ok, [data-testid="buyer-banner"].bad, [data-testid="buyer-banner"].warn', { timeout: 15000 });
    const banner = await p.textContent('[data-testid="buyer-banner"]');
    if (!/PAID/.test(banner ?? "")) throw new Error(`expected PAID on buyer page, got: ${banner}`);
    const timeline = await p.textContent('[data-testid="timeline"]');
    if (!/mandate was bound/i.test(timeline ?? "")) throw new Error("timeline missing mandate step");
    if (!/Settlement/i.test(timeline ?? "")) throw new Error("timeline missing settlement step");
    const bill = await p.textContent('[data-testid="bill"]');
    if (!/You pay/i.test(bill ?? "")) throw new Error("bill missing total row");
    if (!/Why:/i.test(bill ?? "") && !/Rescue relief/i.test(bill ?? "")) throw new Error("bill missing why-line or relief line");
    const trust = await p.textContent('[data-testid="trust-line"]');
    if (!/verified/.test(trust ?? "")) throw new Error("trust line missing chain verification");
    await p.screenshot({ path: "e2e-artifacts/06-buyer-page.png" });
  });

  await browser.close();
  server.kill();

  if (failures > 0) {
    console.log(`\n${failures} E2E failure(s)`);
    process.exit(1);
  }
  console.log("\nAll E2E scenarios passed. Artifacts in e2e-artifacts/");
}

main().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
