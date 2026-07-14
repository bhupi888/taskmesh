/**
 * Backfill `category` on tasks posted before categories existed.
 *
 * WHY THIS IS OK TO DO: a category is OUR OWN label for what domain a ticket
 * belongs to, derived from the ticket's own text. It claims nothing about where
 * the text came from.
 *
 * WHY WE DO NOT BACKFILL `source`: that column says where a task's text was
 * sourced from. Inventing one would be fabricating provenance — exactly the
 * thing the examples file forbids. Old tasks keep `source: null` and render no
 * badge. Do not "helpfully" fill it in.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const CATEGORIES = [
  "Customer Support",
  "E-commerce Disputes",
  "Billing & Payments",
  "Product Feedback",
];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const anthropic = new Anthropic();

const { data: tasks, error } = await sb
  .from("tasks")
  .select("id,prompt")
  .is("category", null);

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`${tasks.length} uncategorised task(s)\n`);

for (const t of tasks) {
  const text = t.prompt.replace(/^Summarize:\s*/i, "").trim();

  const res = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 100,
    system:
      "Classify a support ticket into exactly one category. Answer with the " +
      "category only.\n\n" +
      CATEGORIES.map((c) => `- ${c}`).join("\n"),
    messages: [{ role: "user", content: text.slice(0, 1500) }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { category: { type: "string", enum: CATEGORIES } },
          required: ["category"],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = res.content.find((b) => b.type === "text")?.text ?? "";
  let category;
  try {
    category = JSON.parse(raw).category;
  } catch {
    console.log(`  ${t.id.slice(0, 8)} — could not classify, skipping`);
    continue;
  }
  if (!CATEGORIES.includes(category)) {
    console.log(`  ${t.id.slice(0, 8)} — bad category "${category}", skipping`);
    continue;
  }

  const { error: upErr } = await sb
    .from("tasks")
    .update({ category })
    .eq("id", t.id);

  console.log(
    upErr
      ? `  ${t.id.slice(0, 8)} — FAILED: ${upErr.message}`
      : `  ${t.id.slice(0, 8)} → ${category}`,
  );
}

console.log("\nDone. `source` deliberately left null on these — never invent one.");
