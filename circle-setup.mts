/**
 * One-time Circle Wallets setup.
 *
 *   node --env-file=.env.local circle-setup.mts
 *
 * Circle's developer-controlled wallets need two secrets:
 *   - CIRCLE_API_KEY     — from console.circle.com (you paste this in)
 *   - CIRCLE_ENTITY_SECRET — generated here, and registered with Circle
 *
 * The entity secret is what authorises TaskMesh to sign on behalf of every
 * wallet it creates for a worker. Registering it returns a RECOVERY FILE, which
 * is the only way back in if the entity secret is ever lost. Guard it.
 *
 * Safe to abort if already registered — Circle rejects a second registration.
 */

import {
  generateEntitySecret,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import fs from "node:fs";

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  console.error("Missing CIRCLE_API_KEY in .env.local");
  process.exit(1);
}

if (process.env.CIRCLE_ENTITY_SECRET) {
  console.log("CIRCLE_ENTITY_SECRET already set in .env.local — nothing to do.");
  console.log("(Re-registering would be rejected by Circle anyway.)");
  process.exit(0);
}

// generateEntitySecret() prints to stdout rather than returning; capture it.
const captured: string[] = [];
const realLog = console.log;
console.log = (...args: unknown[]) => captured.push(String(args[0] ?? ""));
generateEntitySecret();
console.log = realLog;

const entitySecret = captured
  .join("\n")
  .match(/[0-9a-f]{64}/i)?.[0];

if (!entitySecret) {
  console.error("Could not generate an entity secret. Raw output:", captured);
  process.exit(1);
}

console.log("Generated entity secret (64 hex chars) — not printing it.");
console.log("Registering it with Circle...");

const res = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
});

const recoveryFile = res.data?.recoveryFile;
if (!recoveryFile) {
  console.error("Registration returned no recovery file. Aborting without saving.");
  process.exit(1);
}

fs.writeFileSync("circle-recovery-file.dat", recoveryFile);

// Append the secret to .env.local. Never printed, never committed.
fs.appendFileSync(".env.local", `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`);

console.log("\nDone.");
console.log("  CIRCLE_ENTITY_SECRET  -> appended to .env.local (gitignored)");
console.log("  recovery file         -> ./circle-recovery-file.dat");
console.log("\n  ACTION: move circle-recovery-file.dat into your password manager.");
console.log("  It is the only way to recover your wallets if the entity secret is lost.");
