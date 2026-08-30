import { pool, query, transaction } from "../db/client.js";
import { SignJWT, jwtVerify, importSPKI, exportJWK, importPKCS8 } from "jose";
import { randomBytes } from "node:crypto";
import { webcrypto } from "node:crypto";

const crypto = webcrypto;

const KEY_ROTATION_DAYS = parseInt(process.env.KEY_ROTATION_DAYS ?? "7");
const JWT_EXPIRY_MINUTES = parseInt(process.env.JWT_EXPIRY_MINUTES ?? "60");
const JWT_REFRESH_DAYS = parseInt(process.env.JWT_REFRESH_DAYS ?? "7");

let currentKeyCache: { keyId: string; privateKey: CryptoKey; publicKey: CryptoKey; publicKeyPem: string; epochStart: Date; epochEnd: Date } | null = null;
let previousKeyCache: { keyId: string; publicKey: CryptoKey; publicKeyPem: string } | null = null;

async function generateEd25519KeyPair(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign", "verify"] as unknown as KeyUsage[]
  );

  const publicKeyPem = await exportToPem(keyPair.publicKey as CryptoKey, "PUBLIC");
  return { 
    privateKey: keyPair.privateKey as CryptoKey, 
    publicKey: keyPair.publicKey as CryptoKey, 
    publicKeyPem 
  };
}

async function exportToPem(key: CryptoKey, type: "PUBLIC" | "PRIVATE"): Promise<string> {
  const format = type === "PUBLIC" ? "spki" : "pkcs8";
  const exported = await crypto.subtle.exportKey(format, key);
  const b64 = Buffer.from(exported).toString("base64");
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${type} KEY-----\n${lines}\n-----END ${type} KEY-----`;
}

async function loadOrCreateCurrentKey(): Promise<{ keyId: string; privateKey: CryptoKey; publicKey: CryptoKey; publicKeyPem: string; epochStart: Date; epochEnd: Date }> {
  if (currentKeyCache && currentKeyCache.epochEnd > new Date()) {
    return currentKeyCache!;
  }

  const result = await query<{
    key_id: string;
    private_key_pem: string;
    public_key_pem: string;
    epoch_start: Date;
    epoch_end: Date;
  }>(
    `SELECT key_id, private_key_pem, public_key_pem, epoch_start, epoch_end
     FROM signing_keys
     WHERE merchant_id = $1 AND is_active = true AND epoch_end > NOW()
     ORDER BY epoch_start DESC
     LIMIT 1`,
    [process.env.RAZORPAY_MERCHANT_ID ?? "merchant_settle_demo"]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0]!;
    const privateKey = await importPKCS8(row.private_key_pem, "Ed25519", { usages: ["sign"] } as any) as CryptoKey;
    const publicKey = await importSPKI(row.public_key_pem, "Ed25519", { usages: ["verify"] } as any) as CryptoKey;
    currentKeyCache = {
      keyId: row.key_id,
      privateKey,
      publicKey,
      publicKeyPem: row.public_key_pem,
      epochStart: row.epoch_start,
      epochEnd: row.epoch_end,
    };
    return currentKeyCache;
  }

  return rotateKey()!;
}

async function rotateKey(): Promise<{ keyId: string; privateKey: CryptoKey; publicKey: CryptoKey; publicKeyPem: string; epochStart: Date; epochEnd: Date }> {
  const merchantId = process.env.RAZORPAY_MERCHANT_ID ?? "merchant_settle_demo";

  await query(
    `UPDATE signing_keys SET is_active = false WHERE merchant_id = $1 AND is_active = true`,
    [merchantId]
  );

  if (currentKeyCache) {
    previousKeyCache = {
      keyId: currentKeyCache.keyId,
      publicKey: currentKeyCache.publicKey,
      publicKeyPem: currentKeyCache.publicKeyPem,
    };
  }

  const { privateKey, publicKey, publicKeyPem } = await generateEd25519KeyPair();
  const keyId = `key_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const epochStart = new Date();
  const epochEnd = new Date(epochStart.getTime() + KEY_ROTATION_DAYS * 24 * 60 * 60 * 1000);

  const privateKeyPem = await exportToPem(privateKey, "PRIVATE");

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO signing_keys (key_id, merchant_id, private_key_pem, public_key_pem, algorithm, epoch_start, epoch_end, is_active)
       VALUES ($1, $2, $3, $4, 'Ed25519', $5, $6, true)`,
      [keyId, merchantId, privateKeyPem, publicKeyPem, epochStart, epochEnd]
    );
  });

  currentKeyCache = { keyId, privateKey, publicKey, publicKeyPem, epochStart, epochEnd };
  return currentKeyCache;
}

export async function getSigningKey(): Promise<{ keyId: string; privateKey: CryptoKey; publicKey: CryptoKey; publicKeyPem: string }> {
  const key = await loadOrCreateCurrentKey();
  return { keyId: key.keyId, privateKey: key.privateKey, publicKey: key.publicKey, publicKeyPem: key.publicKeyPem };
}

export async function getVerificationKeys(): Promise<Array<{ keyId: string; publicKey: CryptoKey; publicKeyPem: string }>> {
  await loadOrCreateCurrentKey();
  const keys: Array<{ keyId: string; publicKey: CryptoKey; publicKeyPem: string }> = [];
  
  if (currentKeyCache) {
    keys.push({ keyId: currentKeyCache.keyId, publicKey: currentKeyCache.publicKey, publicKeyPem: currentKeyCache.publicKeyPem });
  }
  if (previousKeyCache) {
    keys.push({ keyId: previousKeyCache.keyId, publicKey: previousKeyCache.publicKey, publicKeyPem: previousKeyCache.publicKeyPem });
  }

  const result = await query<{ key_id: string; public_key_pem: string }>(
    `SELECT key_id, public_key_pem FROM signing_keys WHERE merchant_id = $1 AND is_active = false AND epoch_end > NOW() - INTERVAL '30 days' ORDER BY epoch_start DESC LIMIT 5`,
    [process.env.RAZORPAY_MERCHANT_ID ?? "merchant_settle_demo"]
  );

  for (const row of result.rows) {
    if (!keys.some((k) => k.keyId === row.key_id)) {
      const publicKey = await importSPKI(row.public_key_pem, "Ed25519", { usages: ["verify"] } as any) as CryptoKey;
      keys.push({ keyId: row.key_id, publicKey, publicKeyPem: row.public_key_pem });
    }
  }

  return keys;
}

export async function signWithCurrentKey(payload: string): Promise<{ keyId: string; signature: string }> {
  const { keyId, privateKey } = await getSigningKey();
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign("Ed25519", privateKey, encoder.encode(payload));
  return { keyId, signature: Buffer.from(signature).toString("base64url") };
}

export async function verifyWithKeys(payload: string, signatureB64: string, keyId?: string): Promise<boolean> {
  const keys = await getVerificationKeys();
  const signature = Buffer.from(signatureB64, "base64url");
  const encoder = new TextEncoder();

  const candidates = keyId ? keys.filter((k) => k.keyId === keyId) : keys;
  for (const key of candidates) {
    try {
      const valid = await crypto.subtle.verify("Ed25519", key.publicKey, signature, encoder.encode(payload));
      if (valid) return true;
    } catch { }
  }
  return false;
}

export async function createJWT(payload: Record<string, unknown>): Promise<string> {
  const { keyId, privateKey } = await getSigningKey();
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: keyId })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_MINUTES}m`)
    .sign(privateKey);
  return jwt;
}

export async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  const keys = await getVerificationKeys();
  for (const key of keys) {
    try {
      const { payload } = await jwtVerify(token, key.publicKey, { algorithms: ["EdDSA"] });
      return payload as Record<string, unknown>;
    } catch { }
  }
  return null;
}

export async function createRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + JWT_REFRESH_DAYS * 24 * 60 * 60 * 1000);
  
  await query(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [token, userId, expiresAt]
  );

  return token;
}

export async function verifyRefreshToken(token: string): Promise<string | null> {
  const result = await query<{ user_id: string }>(
    `SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
    [token]
  );
  return result.rows[0]?.user_id ?? null;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [token]);
}

export async function getJWKS(): Promise<{ keys: any[] }> {
  const keys = await getVerificationKeys();
  const jwks = { keys: [] as any[] };

  for (const key of keys) {
    const jwk = await exportJWK(key.publicKey);
    jwks.keys.push({ ...jwk, kid: key.keyId, use: "sig", alg: "EdDSA" });
  }

  return jwks;
}