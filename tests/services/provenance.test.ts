import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  buildMerkleTree,
  merkleLeaf,
  merkleRootFromPath,
} from "../../src/lib/services/tournament/merkle.js";
import {
  base58Decode,
  base58Encode,
  buildMemoTransaction,
  MEMO_PROGRAM_ID,
  memoStatus,
  parseMemoSigner,
  postMemo,
  type SolanaConfig,
} from "../../src/lib/solana/memo.js";

const PROPERTY_OPTIONS = { numRuns: 48, seed: 0x9a7b } as const;
const hashArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString("hex"));

function hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A fresh wallet secret in solana-keygen's JSON form: seed then public key. */
function keygenSecret(): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return JSON.stringify([...seed, ...pub]);
}

describe("Merkle tree", () => {
  it("roots a single leaf at its own leaf hash", () => {
    const tree = buildMerkleTree([hex("a")]);
    expect(tree.root).toBe(merkleLeaf(hex("a")));
    expect(tree.paths).toEqual([[]]);
  });

  it("proves every leaf of every size, odd sizes included", () => {
    fc.assert(
      fc.property(fc.array(hashArb, { minLength: 1, maxLength: 33 }), (hashes) => {
        const tree = buildMerkleTree(hashes);
        hashes.forEach((hash, index) => {
          expect(merkleRootFromPath(hash, tree.paths[index]!)).toBe(tree.root);
        });
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("does not prove a leaf against another leaf's path, nor a duplicated last leaf", () => {
    const hashes = [hex("a"), hex("b"), hex("c")];
    const tree = buildMerkleTree(hashes);
    expect(merkleRootFromPath(hashes[0]!, tree.paths[1]!)).not.toBe(tree.root);
    // Promotion, not duplication: [a, b, c] and [a, b, c, c] commit to different roots.
    expect(buildMerkleTree([...hashes, hex("c")]).root).not.toBe(tree.root);
  });

  it("rejects malformed input", () => {
    expect(() => buildMerkleTree([])).toThrow(RangeError);
    expect(() => merkleLeaf("XYZ")).toThrow(RangeError);
    expect(() => merkleRootFromPath(hex("a"), ["Q:00"])).toThrow(RangeError);
  });
});

describe("Solana memo transaction", () => {
  it("round-trips base58 including leading zeros", () => {
    const bytes = Buffer.from([0, 0, 1, 2, 255, 128]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    expect(base58Decode(MEMO_PROGRAM_ID)).toHaveLength(32);
  });

  it("reads keygen and base58 secrets and refuses a mismatched public half", () => {
    const secret = keygenSecret();
    const fromJson = parseMemoSigner(secret);
    const fromBase58 = parseMemoSigner(base58Encode(Buffer.from(JSON.parse(secret) as number[])));
    expect(fromBase58.publicKey).toEqual(fromJson.publicKey);
    const tampered = JSON.parse(secret) as number[];
    tampered[63] = (tampered[63]! + 1) % 256;
    expect(() => parseMemoSigner(JSON.stringify(tampered))).toThrow(RangeError);
  });

  it("signs one legacy message holding the payer, the memo program, and the memo", () => {
    const signer = parseMemoSigner(keygenSecret());
    const blockhash = base58Encode(Buffer.alloc(32, 7));
    const memo = `openmarket.tournament.v1 2026-10-19T20:00:00.000Z ${hex("root")} 3`;
    const signed = buildMemoTransaction(signer, blockhash, memo);
    const wire = Buffer.from(signed.transaction, "base64");

    expect(wire[0]).toBe(1);
    const signature = wire.subarray(1, 65);
    const message = wire.subarray(65);
    expect(base58Encode(signature)).toBe(signed.signature);
    expect(
      verify(
        null,
        message,
        createPublicKey({
          key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), signer.publicKey]),
          format: "der",
          type: "spki",
        }),
        signature,
      ),
    ).toBe(true);

    expect([...message.subarray(0, 4)]).toEqual([1, 0, 1, 2]);
    expect(message.subarray(4, 36)).toEqual(signer.publicKey);
    expect(message.subarray(36, 68)).toEqual(base58Decode(MEMO_PROGRAM_ID));
    expect(message.subarray(68, 100)).toEqual(Buffer.alloc(32, 7));
    // One instruction: program index 1, no accounts, the memo bytes.
    expect([...message.subarray(100, 104)]).toEqual([1, 1, 0, Buffer.byteLength(memo)]);
    expect(message.subarray(104).toString("utf8")).toBe(memo);
  });

  it("posts through JSON-RPC and reads confirmation", async () => {
    const config: SolanaConfig = {
      rpcUrl: "https://rpc.test",
      cluster: "devnet",
      signer: parseMemoSigner(keygenSecret()),
    };
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      methods.push(body.method);
      if (body.method === "getLatestBlockhash") {
        return Response.json({
          result: { value: { blockhash: base58Encode(Buffer.alloc(32, 9)) } },
        });
      }
      if (body.method === "sendTransaction") {
        const wire = Buffer.from(body.params[0] as string, "base64");
        return Response.json({ result: base58Encode(wire.subarray(1, 65)) });
      }
      return Response.json({
        result: { value: [{ err: null, confirmationStatus: "finalized" }] },
      });
    });
    const signature = await postMemo(config, "memo", fetchImpl as typeof fetch);
    expect(await memoStatus(config, signature, fetchImpl as typeof fetch)).toBe("confirmed");
    expect(methods).toEqual(["getLatestBlockhash", "sendTransaction", "getSignatureStatuses"]);
  });
});
