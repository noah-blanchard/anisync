import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

const VERSION = "v1";
let keyCache: { secret: string; key: Buffer } | null = null;

function encryptionKey(): Buffer {
  const secret = getEnv().APP_SECRET;
  if (keyCache?.secret === secret) return keyCache.key;
  const key = Buffer.from(hkdfSync("sha256", secret, "anisync", "token-encryption:v1", 32));
  keyCache = { secret, key };
  return key;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Format chiffré invalide");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/** Constant-time string comparison (hashes first so lengths do not leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const UNBIASED_LIMIT = 256 - (256 % UNRESERVED.length);

/** Random string from the RFC 7636 unreserved charset (PKCE verifier, OAuth state). */
export function randomUnreserved(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < UNBIASED_LIMIT && out.length < length) out += UNRESERVED[byte % UNRESERVED.length];
    }
  }
  return out;
}
