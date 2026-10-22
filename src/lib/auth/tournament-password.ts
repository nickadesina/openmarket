import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Tournament account passwords: `scrypt$16384$8$1$<salt>$<key>`, salt and key
 * canonical base64url. The work factors are fixed, so a stored hash can never
 * select a weaker setting or exhaust a serverless function's memory.
 */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_MAX_MEMORY_BYTES = 32 * 1024 * 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY_BYTES },
      (error, derived) => (error === null ? resolve(derived) : reject(error)),
    );
  });
}

function decodeField(value: string | undefined, bytes: number): Buffer {
  if (value === undefined || !BASE64URL_PATTERN.test(value)) {
    throw new Error("Password hash fields must be base64url.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value) {
    throw new Error(`Password hash fields must be canonical base64url of ${bytes} bytes.`);
  }
  return decoded;
}

function parseHash(encodedHash: string): { readonly salt: Buffer; readonly key: Buffer } {
  const fields = encodedHash.split("$");
  if (
    fields.length !== 6 ||
    fields[0] !== "scrypt" ||
    fields[1] !== String(SCRYPT_N) ||
    fields[2] !== String(SCRYPT_R) ||
    fields[3] !== String(SCRYPT_P)
  ) {
    throw new Error("Password hash must use scrypt$16384$8$1$salt$key format.");
  }
  return { salt: decodeField(fields[4], SALT_BYTES), key: decodeField(fields[5], KEY_BYTES) };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parseHash(encodedHash);
  return timingSafeEqual(await derive(password, parsed.salt), parsed.key);
}

let timingHash: Promise<string> | undefined;

/** Verifies against a throwaway hash so an unknown username costs as much time as a wrong password. */
export async function burnPasswordCheck(password: string): Promise<void> {
  timingHash ??= hashPassword(randomBytes(18).toString("base64url"));
  await verifyPassword(password, await timingHash);
}
