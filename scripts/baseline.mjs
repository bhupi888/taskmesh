/**
 * One-off: mark every existing migration as already applied.
 *
 * The migrations in supabase/migrations/ were applied by hand through the
 * dashboard before scripts/migrate.mjs existed. Without this, migrate.mjs would
 * try to re-run them — and while most are idempotent, enable_realtime is not.
 *
 * Safe to delete once run; kept only so the history is legible.
 */

import { readFileSync, readdirSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

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
  if (!res.ok) throw new Error(body);
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

const files = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();

const values = files.map((f) => `('${f}')`).join(", ");
await sql(
  `insert into public._migrations (name) values ${values} on conflict do nothing;`,
);

const rows = await sql("select name from public._migrations order by name;");
console.log("Baselined as already-applied:");
for (const r of rows) console.log(`  ${r.name}`);
