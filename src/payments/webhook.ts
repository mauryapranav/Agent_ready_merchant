import { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRazorpayClient, processWebhookEvent, verifyWebhookSignature } from "./checkout.js";
import { pool, query } from "../db/client.js";

const __dirname = join(fileURLToPath(import.meta.url), "..");

export async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost`);
  
  if (req.method !== "POST" || url.pathname !== "/api/webhook/razorpay") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("RAZORPAY_WEBHOOK_SECRET not configured");
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Webhook secret not configured" }));
    return;
  }

  const signature = req.headers["x-razorpay-signature"] as string;
  if (!signature) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Missing signature" }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");

  if (!verifyWebhookSignature(webhookSecret, body, signature)) {
    console.warn("Invalid webhook signature");
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid signature" }));
    return;
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const merchantId = process.env.RAZORPAY_MERCHANT_ID ?? "merchant_settle_demo";

  try {
    await processWebhookEvent(event, merchantId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}