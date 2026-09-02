import { scrypt, timingSafeEqual } from "node:crypto";

export const ADMIN_SCRYPT_N = 16_384;
export const ADMIN_SCRYPT_R = 8;
export const ADMIN_SCRYPT_P = 1;
export const ADMIN_SCRYPT_SALT_BYTES = 16;
export const ADMIN_SCRYPT_KEY_BYTES = 64;

const SCRYPT_MAX_MEMORY_BYTES = 32 * 1024 * 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

interface AdminPassphraseHash {
  readonly salt: Buffer;
  readonly derivedKey: Buffer;
}

type PassphraseEnvironment = Readonly<Record<string, string | undefined>>;

function decodeCanonicalBase64Url(value: string, expectedBytes: number, field: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error(`ADMIN_PASSPHRASE_HASH ${field} must be base64url`);
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    throw new Error(
      `ADMIN_PASSPHRASE_HASH ${field} must be canonical base64url encoding ${expectedBytes} bytes`,
    );
  }
  return decoded;
}

/**
 * Parses the versioned deployment format:
 * `scrypt$16384$8$1$<16-byte-salt-base64url>$<64-byte-key-base64url>`.
 * The fixed work factors prevent an environment value from selecting an
 * unexpectedly weak hash or exhausting a serverless function's memory.
 */
function parseAdminPassphraseHash(encodedHash: string): AdminPassphraseHash {
  const fields = encodedHash.split("$");
  if (
    fields.length !== 6 ||
    fields[0] !== "scrypt" ||
    fields[1] !== String(ADMIN_SCRYPT_N) ||
    fields[2] !== String(ADMIN_SCRYPT_R) ||
    fields[3] !== String(ADMIN_SCRYPT_P)
  ) {
    throw new Error("ADMIN_PASSPHRASE_HASH must use scrypt$16384$8$1$salt$key format");
  }

  const saltField = fields[4];
  const keyField = fields[5];
  if (saltField === undefined || keyField === undefined) {
    throw new Error("ADMIN_PASSPHRASE_HASH is incomplete");
  }

  return {
    salt: decodeCanonicalBase64Url(saltField, ADMIN_SCRYPT_SALT_BYTES, "salt"),
    derivedKey: decodeCanonicalBase64Url(keyField, ADMIN_SCRYPT_KEY_BYTES, "derived key"),
  };
}

export function assertAdminPassphraseHash(encodedHash: string): void {
  parseAdminPassphraseHash(encodedHash);
}

export function getAdminPassphraseHash(environment: PassphraseEnvironment = process.env): string {
  const encodedHash = environment.ADMIN_PASSPHRASE_HASH;
  if (encodedHash === undefined || encodedHash.length === 0) {
    throw new Error("ADMIN_PASSPHRASE_HASH is required");
  }
  return encodedHash;
}

export async function verifyAdminPassphrase(
  passphrase: string,
  encodedHash: string,
): Promise<boolean> {
  const parsed = parseAdminPassphraseHash(encodedHash);
  const candidate = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      passphrase,
      parsed.salt,
      ADMIN_SCRYPT_KEY_BYTES,
      {
        N: ADMIN_SCRYPT_N,
        r: ADMIN_SCRYPT_R,
        p: ADMIN_SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY_BYTES,
      },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });

  return timingSafeEqual(candidate, parsed.derivedKey);
}
