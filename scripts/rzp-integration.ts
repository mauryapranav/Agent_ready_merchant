import { createRazorpayClient, credentialsFromEnv } from "../src/razorpay/client.js";
import { RazorpayExecutor } from "../src/payments/executor.js";

try{
  process.loadEnvFile();
}catch{
}
const creds = credentialsFromEnv();
if (!creds) {
  console.error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set. Add them to .env and re-run.");
  process.exit(1);
}

const client = createRazorpayClient(creds);
const executor = new RazorpayExecutor(client);

console.log(`Contacting Razorpay test API as ${creds.keyId.slice(0, 12)}...`);
const result = await executor.charge({
  rail: "upi",
  amountPaise: 100,
  idempotencyKey: "rzp-integration-check-1",
  receiptId: `settle_integration_${Date.now().toString(36)}`,
  notes: { purpose: "settle-integration-check" },
});

if (!result.ok) {
  console.error("FAILED:", result.errorCode);
  process.exit(1);
}
console.log("Real test-mode order created:");
console.log(JSON.stringify(result, null, 2));
