import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createPrivateKey, createPublicKey } from "node:crypto";

export interface SigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function generateSigningKeyPair(): SigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function signTip(tipHash: string, privateKeyPem: string): string {
  const signature = cryptoSign(null, Buffer.from(tipHash, "hex"), createPrivateKey(privateKeyPem));
  return signature.toString("base64");
}

export function verifyTipSignature(tipHash: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(tipHash, "hex"), createPublicKey(publicKeyPem), Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
