import { createPrivateKey, createPublicKey, type KeyObject, sign } from "node:crypto";

import { z } from "zod";

/**
 * A memo-only Solana transaction, built and signed without a Solana SDK:
 * one legacy message with the fee payer and the SPL Memo program, one
 * instruction carrying the memo bytes, signed with Node's ed25519. No
 * program of our own, no tokens; the wallet only ever pays fees.
 */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

export function base58Decode(text: string): Buffer {
  let value = 0n;
  for (const character of text) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new RangeError("invalid base58 character");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const character of text) {
    if (character !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

/** Solana's compact-u16 ("shortvec") length prefix. */
function compactU16(length: number): Buffer {
  const bytes: number[] = [];
  let remaining = length;
  for (;;) {
    const byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining === 0) {
      bytes.push(byte);
      return Buffer.from(bytes);
    }
    bytes.push(byte | 0x80);
  }
}

export interface MemoSigner {
  readonly publicKey: Buffer;
  readonly privateKey: KeyObject;
}

/**
 * Reads a wallet secret in either form `solana-keygen` and wallets export:
 * a JSON array of 64 bytes, or base58 of the same 64 bytes (seed then
 * public key). The public half must match the seed.
 */
export function parseMemoSigner(secret: string): MemoSigner {
  const trimmed = secret.trim();
  const bytes = trimmed.startsWith("[")
    ? Buffer.from(z.array(z.number().int().min(0).max(255)).length(64).parse(JSON.parse(trimmed)))
    : base58Decode(trimmed);
  if (bytes.length !== 64) throw new RangeError("a Solana secret key is 64 bytes");
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, bytes.subarray(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  if (!publicKey.equals(bytes.subarray(32))) {
    throw new RangeError("the secret key's public half does not match its seed");
  }
  return { publicKey, privateKey };
}

export interface SignedMemo {
  /** Base58 transaction signature: the id explorers and RPC know it by. */
  readonly signature: string;
  /** Base64 wire transaction for `sendTransaction`. */
  readonly transaction: string;
}

export function buildMemoTransaction(
  signer: MemoSigner,
  recentBlockhash: string,
  memo: string,
): SignedMemo {
  const blockhash = base58Decode(recentBlockhash);
  if (blockhash.length !== 32) throw new RangeError("a blockhash is 32 bytes");
  const data = Buffer.from(memo, "utf8");
  const message = Buffer.concat([
    // One signer (the payer); no read-only signers; one read-only account (the program).
    Buffer.from([1, 0, 1]),
    compactU16(2),
    signer.publicKey,
    base58Decode(MEMO_PROGRAM_ID),
    blockhash,
    compactU16(1),
    // Program index 1, no accounts, the memo as instruction data.
    Buffer.from([1]),
    compactU16(0),
    compactU16(data.length),
    data,
  ]);
  const signature = sign(null, message, signer.privateKey);
  return {
    signature: base58Encode(signature),
    transaction: Buffer.concat([compactU16(1), signature, message]).toString("base64"),
  };
}

export interface SolanaConfig {
  readonly rpcUrl: string;
  readonly cluster: "mainnet-beta" | "devnet";
  readonly signer: MemoSigner;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function solanaCluster(environment: Environment = process.env): SolanaConfig["cluster"] {
  return environment.SOLANA_CLUSTER === "devnet" ? "devnet" : "mainnet-beta";
}

/** Null when no provenance wallet is configured: batches are still built, just not posted. */
export function solanaConfig(environment: Environment = process.env): SolanaConfig | null {
  const secret = environment.SOLANA_PROVENANCE_SECRET_KEY?.trim();
  if (secret === undefined || secret === "") return null;
  const cluster = solanaCluster(environment);
  const rpcUrl =
    environment.SOLANA_RPC_URL?.trim() ||
    (cluster === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com");
  return { rpcUrl, cluster, signer: parseMemoSigner(secret) };
}

export function explorerUrl(signature: string, cluster: SolanaConfig["cluster"]): string {
  const query = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${query}`;
}

async function rpc<T>(
  config: SolanaConfig,
  method: string,
  params: unknown[],
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Solana RPC ${method} failed (${response.status})`);
  const body = z
    .object({ result: schema.optional(), error: z.object({ message: z.string() }).optional() })
    .parse(await response.json());
  if (body.error !== undefined || body.result === undefined) {
    throw new Error(`Solana RPC ${method} failed: ${body.error?.message ?? "no result"}`);
  }
  return body.result;
}

/** Signs and submits a memo; returns its signature once the RPC node accepts it. */
export async function postMemo(
  config: SolanaConfig,
  memo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const latest = await rpc(
    config,
    "getLatestBlockhash",
    [{ commitment: "finalized" }],
    z.object({ value: z.object({ blockhash: z.string() }) }),
    fetchImpl,
  );
  const signed = buildMemoTransaction(config.signer, latest.value.blockhash, memo);
  const accepted = await rpc(
    config,
    "sendTransaction",
    [signed.transaction, { encoding: "base64", preflightCommitment: "confirmed" }],
    z.string(),
    fetchImpl,
  );
  if (accepted !== signed.signature) throw new Error("Solana RPC returned a different signature");
  return signed.signature;
}

/** "confirmed" once the cluster has it at confirmed or finalized; "failed" if it errored; else null. */
export async function memoStatus(
  config: SolanaConfig,
  signature: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"confirmed" | "failed" | null> {
  const result = await rpc(
    config,
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
    z.object({
      value: z.array(
        z
          .object({ err: z.unknown().nullable(), confirmationStatus: z.string().nullable() })
          .nullable(),
      ),
    }),
    fetchImpl,
  );
  const status = result.value[0] ?? null;
  if (status === null) return null;
  if (status.err !== null && status.err !== undefined) return "failed";
  return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized"
    ? "confirmed"
    : null;
}
