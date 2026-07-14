/**
 * Apply a Supabase migration from the command line.
 *
 *   node scripts/migrate.mjs                      # apply any not-yet-applied migrations
 *   node scripts/migrate.mjs 20260714030000_...   # apply one specific file
 *
 * WHY THIS EXISTS: there is no way to run DDL through the Supabase JS client —
 * PostgREST only does data, not schema. So every schema change used to mean
 * pasting SQL into the dashboard by hand, which cost us three round-trips in one
 * afternoon and meant code could be committed against columns that didn't exist
 * yet (the board 500s in exactly that window — see PROJECT_NOTES).
 *
 * Supabase's Management API *can* run DDL, so this drives that.
 *
 * Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in .env.local.
 * The token is a PERSONAL ACCESS TOKEN (sbp_…), not the service role key, and it
 * is ACCOUNT-WIDE — it can touch every project on the account. Never commit it,
 * never log it, never put it in a command line (it lands in shell history).
 * Generate/revoke at https://supabase.com/dashboard/account/tokens
 *
 * Migrations are tracked in a `_migrations` table so re-running is safe.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

if (!TOKEN || !REF) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in .env.local.\n" +
      "Generate a token at https://supabase.com/dashboard/account/tokens",
  );
  process.exit(1);
}

/** Run SQL against the project. Throws with Postgres's own message on failure. */
async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    return [];
  }
}

await sql(`
  create table if not exists public._migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );
`);

const applied = new Set(
  (await sql("select name from public._migrations;")).map((r) => r.name),
);

const only = process.argv[2];
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (only ? f.includes(only) : true))
  .sort();

if (files.length === 0) {
  console.error(only ? `No migration matching "${only}"` : "No migrations found");
  process.exit(1);
}

let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip  ${file} (already applied)`);
    continue;
  }

  process.stdout.write(`  apply ${file} … `);
  try {
    await sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    // Record it only after the DDL actually succeeded, so a failed migration
    // isn't marked done and silently skipped on the next run.
    await sql(
      `insert into public._migrations (name) values ('${file}') on conflict do nothing;`,
    );
    console.log("ok");
    ran++;
  } catch (err) {
    console.log("FAILED");
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}

console.log(
  ran === 0 ? "\nNothing to do — schema is up to date." : `\nApplied ${ran} migration(s).`,
);
