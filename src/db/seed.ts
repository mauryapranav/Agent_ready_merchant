import { pool, query, closePool } from "./client.js";
import { randomBytes, createHash } from "node:crypto";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

async function main() {
  console.log("Seeding database...");

  const merchantId = "merchant_settle_demo";

  // Upsert merchant
  await query(
    `INSERT INTO merchants (merchant_id, name, razorpay_env, floor_margin_pct, max_releases_per_day, daily_release_budget_paise, cooldown_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (merchant_id) DO UPDATE SET
       razorpay_env = EXCLUDED.razorpay_env,
       floor_margin_pct = EXCLUDED.floor_margin_pct,
       max_releases_per_day = EXCLUDED.max_releases_per_day,
       daily_release_budget_paise = EXCLUDED.daily_release_budget_paise,
       cooldown_minutes = EXCLUDED.cooldown_minutes,
       updated_at = NOW()`,
    [merchantId, "Settle Demo Store", "test", 12, 50, 500000, 30]
  );

  // Seed products
  const products = [
    { sku: "nike-peg-41", title: "Nike Pegasus 41", brand: "Nike", category: "shoes", price: 4180, cost: 2508 },
    { sku: "adidas-ultra-24", title: "Adidas Ultraboost 24", brand: "Adidas", category: "shoes", price: 4500, cost: 2700 },
    { sku: "puma-velocity-3", title: "Puma Velocity Nitro 3", brand: "Puma", category: "shoes", price: 3200, cost: 1920 },
    { sku: "jockey-socks-3pk", title: "Jockey Socks 3-Pack", brand: "Jockey", category: "accessories", price: 459, cost: 184 },
    { sku: "nike-dri-fit-tee", title: "Nike Dri-FIT Tee", brand: "Nike", category: "apparel", price: 1200, cost: 480 },
    { sku: "adidas-hoodie", title: "Adidas Essentials Hoodie", brand: "Adidas", category: "apparel", price: 2800, cost: 1120 },
    { sku: "noise-colorfit-4", title: "Noise ColorFit Pro 4", brand: "Noise", category: "electronics", price: 2999, cost: 1799 },
    { sku: "jockey-briefs-2pk", title: "Jockey Briefs 2-Pack", brand: "Jockey", category: "apparel", price: 650, cost: 260 },
    { sku: "nike-air-zoom", title: "Nike Air Zoom Alphafly", brand: "Nike", category: "shoes", price: 8500, cost: 5100 },
    { sku: "puma-rs-x", title: "Puma RS-X", brand: "Puma", category: "shoes", price: 3800, cost: 2280 },
    { sku: "adidas-backpack", title: "Adidas Linear Backpack", brand: "Adidas", category: "accessories", price: 1500, cost: 600 },
    { sku: "noise-buds-3", title: "Noise Buds VS103", brand: "Noise", category: "electronics", price: 1299, cost: 650 },
  ];

  for (const p of products) {
    await query(
      `INSERT INTO products (sku, merchant_id, title, brand, category, price_paise, cost_paise, image_hint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (sku) DO UPDATE SET
         title = EXCLUDED.title,
         brand = EXCLUDED.brand,
         category = EXCLUDED.category,
         price_paise = EXCLUDED.price_paise,
         cost_paise = EXCLUDED.cost_paise,
         image_hint = EXCLUDED.image_hint,
         updated_at = NOW()`,
      [p.sku, merchantId, p.title, p.brand, p.category, p.price * 100, p.cost * 100, p.sku]
    );
  }

  // Seed swap alternatives
  const swaps = [
    ["nike-peg-41", "puma-velocity-3"],
    ["nike-peg-41", "adidas-ultra-24"],
    ["adidas-ultra-24", "puma-velocity-3"],
    ["nike-air-zoom", "puma-rs-x"],
    ["noise-colorfit-4", "noise-buds-3"],
  ];

  for (const [from, to] of swaps) {
    await query(
      `INSERT INTO swap_alternatives (from_sku, to_sku) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [from, to]
    );
  }

  // Seed inventory
  for (const p of products) {
    await query(
      `INSERT INTO inventory (sku, merchant_id, total_qty, reserved_qty)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (sku) DO UPDATE SET
         merchant_id = EXCLUDED.merchant_id,
         total_qty = EXCLUDED.total_qty`,
      [p.sku, merchantId, 100]
    );
  }

  // Seed campaigns
  const now = new Date();
  const validTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const campaigns = [
    // Budgets are deliberately sized to two draws each so the funded-campaign step visibly runs
    // dry during a short demo run and the waterfall falls through to the next funding source.
    { id: "camp_nike_summer", label: "Nike Summer Sale", flatOff: 50000, minCart: 300000, fundedBy: "brand", budget: 100000 },
    { id: "camp_adidas_monsoon", label: "Adidas Monsoon Offer", flatOff: 40000, minCart: 250000, fundedBy: "brand", budget: 80000 },
    { id: "camp_merchant_diwali", label: "Diwali Marketing Campaign", flatOff: 30000, minCart: 200000, fundedBy: "merchant_marketing", budget: 60000 },
  ];

  for (const c of campaigns) {
    await query(
      `INSERT INTO campaigns (campaign_id, merchant_id, label, flat_off_paise, min_cart_paise, funded_by, remaining_budget_paise, total_budget_paise, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (campaign_id) DO UPDATE SET
         remaining_budget_paise = EXCLUDED.remaining_budget_paise,
         total_budget_paise = EXCLUDED.total_budget_paise,
         valid_to = EXCLUDED.valid_to,
         updated_at = NOW()`,
      [c.id, merchantId, c.label, c.flatOff, c.minCart, c.fundedBy, c.budget, c.budget, now, validTo]
    );
  }

  // Seed rail offers
  const railOffers = [
    { id: "rail_upi_hdfc", rail: "upi", label: "HDFC UPI 10% Off", discountPct: 10, maxDiscount: 50000, fundedBy: "bank" },
    { id: "rail_card_icici", rail: "card", label: "ICICI Card 15% Off", discountPct: 15, maxDiscount: 75000, fundedBy: "bank" },
    { id: "rail_netbanking_sbi", rail: "netbanking", label: "SBI NetBanking 5% Off", discountPct: 5, maxDiscount: 25000, fundedBy: "network" },
    { id: "rail_wallet_paytm", rail: "wallet", label: "Paytm Wallet Cashback", discountPct: 8, maxDiscount: 30000, fundedBy: "network" },
  ];

  for (const r of railOffers) {
    await query(
      `INSERT INTO rail_offers (offer_id, merchant_id, rail, label, discount_pct, max_discount_paise, funded_by, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (offer_id) DO UPDATE SET
         discount_pct = EXCLUDED.discount_pct,
         max_discount_paise = EXCLUDED.max_discount_paise,
         valid_to = EXCLUDED.valid_to,
         updated_at = NOW()`,
      [r.id, merchantId, r.rail, r.label, r.discountPct, r.maxDiscount, r.fundedBy, now, validTo]
    );
  }

  // Seed admin user (password: admin123)
  const passwordHash = await hashPassword("admin123");
  await query(
    `INSERT INTO admin_users (user_id, merchant_id, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    ["admin_1", merchantId, "admin@settle.demo", passwordHash, "admin"]
  );

  console.log("Seeding completed successfully");
  await closePool();
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});