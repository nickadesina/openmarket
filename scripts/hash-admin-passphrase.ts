import { text } from "node:stream/consumers";

import { hashAdminPassphrase } from "../src/lib/auth/admin-passphrase.js";

/**
 * Prints an `ADMIN_PASSPHRASE_HASH` for a passphrase typed at a hidden prompt
 * (or piped on stdin), so the passphrase itself never lands in shell history,
 * a file, or a chat transcript. Run it on the machine that will hold the hash.
 */

const ENTER = new Set(["\r", "\n"]);
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACE = new Set(["\u007f", "\b"]);

// Keystrokes typed or pasted past one Enter belong to the next prompt.
let typedAhead: string[] = [];

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let characters: string[] = [];
    const finish = (): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write("\n");
    };
    const consume = (): void => {
      while (typedAhead.length > 0) {
        const [character = "", ...rest] = typedAhead;
        typedAhead = rest;
        if (ENTER.has(character) || character === CTRL_D) {
          finish();
          resolve(characters.join(""));
          return;
        }
        if (character === CTRL_C) {
          finish();
          reject(new Error("cancelled"));
          return;
        }
        characters = BACKSPACE.has(character)
          ? characters.slice(0, -1)
          : [...characters, character];
      }
    };
    const onData = (chunk: string): void => {
      typedAhead = [...typedAhead, ...chunk];
      consume();
    };
    input.on("data", onData);
    input.resume();
    consume();
  });
}

async function readPassphrase(): Promise<string> {
  if (!process.stdin.isTTY) {
    return (await text(process.stdin)).replace(/\r?\n$/, "");
  }
  const passphrase = await readHidden("Admin passphrase: ");
  const confirmation = await readHidden("Repeat passphrase: ");
  if (passphrase !== confirmation) {
    throw new Error("passphrases do not match");
  }
  return passphrase;
}

async function main(): Promise<void> {
  const passphrase = await readPassphrase();
  if (passphrase.length === 0) {
    throw new Error("passphrase is empty");
  }
  const hash = await hashAdminPassphrase(passphrase);
  console.log(`Vercel (paste as is):\n  ADMIN_PASSPHRASE_HASH=${hash}\n`);
  console.log(`.env.local ($ escaped):\n  ADMIN_PASSPHRASE_HASH=${hash.replaceAll("$", "\\$")}`);
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Could not hash the admin passphrase: ${message}`);
  process.exitCode = 1;
}
