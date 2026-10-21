import { randomBytes, scrypt } from "node:crypto";

import {
  ADMIN_SCRYPT_KEY_BYTES,
  ADMIN_SCRYPT_N,
  ADMIN_SCRYPT_P,
  ADMIN_SCRYPT_R,
  ADMIN_SCRYPT_SALT_BYTES,
  verifyAdminPassphrase,
} from "./admin-passphrase.js";

/**
 * Tournament account passwords use the admin passphrase's scrypt format,
 * `scrypt$16384$8$1$<salt>$<key>`, so one parser and one constant-time
 * comparison serve both.
 */
const SCRYPT_MAX_MEMORY_BYTES = 32 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(ADMIN_SCRYPT_SALT_BYTES);
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      ADMIN_SCRYPT_KEY_BYTES,
      { N: ADMIN_SCRYPT_N, r: ADMIN_SCRYPT_R, p: ADMIN_SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY_BYTES },
      (error, derived) => (error === null ? resolve(derived) : reject(error)),
    );
  });
  return [
    "scrypt",
    ADMIN_SCRYPT_N,
    ADMIN_SCRYPT_R,
    ADMIN_SCRYPT_P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  return verifyAdminPassphrase(password, encodedHash);
}

let timingHash: Promise<string> | undefined;

/** Verifies against a throwaway hash so an unknown username costs as much time as a wrong password. */
export async function burnPasswordCheck(password: string): Promise<void> {
  timingHash ??= hashPassword(randomBytes(18).toString("base64url"));
  await verifyPassword(password, await timingHash);
}
