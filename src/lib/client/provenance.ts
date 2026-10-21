import type { ProvenanceProof } from "../services/tournament/provenance.js";

/**
 * In-browser re-verification of a provenance proof with Web Crypto, so the
 * page checks the server rather than repeating its word. Mirrors
 * `services/tournament/merkle.ts` and `forecastEventHash`; keep them in step.
 */

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sha256(...parts: Uint8Array[]): Promise<string> {
  const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return toHex(await crypto.subtle.digest("SHA-256", joined));
}

export interface BrowserVerification {
  readonly eventHash: string;
  readonly hashMatches: boolean;
  /** Null when the event is not batched yet. */
  readonly root: string | null;
  readonly rootMatches: boolean | null;
}

export async function verifyProofInBrowser(proof: ProvenanceProof): Promise<BrowserVerification> {
  const { event, batch } = proof;
  const encoder = new TextEncoder();
  const eventHash = await sha256(
    encoder.encode(`${event.questionId}${event.userId}${event.submittedAt}${event.probsCanonical}`),
  );
  if (batch === null) {
    return { eventHash, hashMatches: eventHash === event.eventHash, root: null, rootMatches: null };
  }
  let hash = await sha256(new Uint8Array([0]), fromHex(eventHash));
  for (const step of batch.path) {
    const [side, sibling = ""] = step.split(":");
    hash =
      side === "L"
        ? await sha256(new Uint8Array([1]), fromHex(sibling), fromHex(hash))
        : await sha256(new Uint8Array([1]), fromHex(hash), fromHex(sibling));
  }
  return {
    eventHash,
    hashMatches: eventHash === event.eventHash,
    root: hash,
    rootMatches: hash === batch.root,
  };
}
