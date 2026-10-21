import { createHash } from "node:crypto";

/**
 * SHA-256 Merkle tree over forecast event hashes.
 *
 *   leaf = sha256(0x00 || event_hash)          node = sha256(0x01 || left || right)
 *
 * The prefixes keep a leaf from ever posing as an internal node. An odd
 * node at the end of a level is promoted unchanged rather than paired with
 * a copy of itself, so no two leaf lists share a root. The proof page
 * re-implements `merkleRootFromPath` in the browser; keep the two in step.
 */

const HEX_64 = /^[0-9a-f]{64}$/;

function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

export function merkleLeaf(eventHash: string): string {
  if (!HEX_64.test(eventHash)) throw new RangeError("event hash must be 64 lowercase hex digits");
  return sha256(Buffer.from([0]), Buffer.from(eventHash, "hex")).toString("hex");
}

function merkleNode(left: string, right: string): string {
  return sha256(Buffer.from([1]), Buffer.from(left, "hex"), Buffer.from(right, "hex")).toString(
    "hex",
  );
}

export interface MerkleTree {
  readonly root: string;
  /** Per leaf, sibling hashes from the leaf up: "L:<hex>" sits left of the running hash. */
  readonly paths: string[][];
}

export function buildMerkleTree(eventHashes: readonly string[]): MerkleTree {
  if (eventHashes.length === 0) throw new RangeError("a Merkle tree needs at least one leaf");
  let level = eventHashes.map(merkleLeaf);
  // positions[i] is leaf i's index within the current level.
  const positions = eventHashes.map((_hash, index) => index);
  const paths: string[][] = eventHashes.map(() => []);

  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const right = level[index + 1];
      next.push(right === undefined ? level[index]! : merkleNode(level[index]!, right));
    }
    positions.forEach((position, leaf) => {
      const sibling = position % 2 === 0 ? position + 1 : position - 1;
      const siblingHash = level[sibling];
      if (siblingHash !== undefined) {
        paths[leaf]!.push(`${position % 2 === 0 ? "R" : "L"}:${siblingHash}`);
      }
      positions[leaf] = Math.floor(position / 2);
    });
    level = next;
  }
  return { root: level[0]!, paths };
}

/** Folds a leaf's path back up; equal to the batch root when the proof holds. */
export function merkleRootFromPath(eventHash: string, path: readonly string[]): string {
  let hash = merkleLeaf(eventHash);
  for (const step of path) {
    const [side, sibling] = step.split(":");
    if ((side !== "L" && side !== "R") || sibling === undefined || !HEX_64.test(sibling)) {
      throw new RangeError("malformed Merkle path step");
    }
    hash = side === "L" ? merkleNode(sibling, hash) : merkleNode(hash, sibling);
  }
  return hash;
}
