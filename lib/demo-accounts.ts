/**
 * Demo accounts — a persona switcher, NOT authentication.
 *
 * ⚠️ BE HONEST ABOUT THIS, IN THE UI AND OUT LOUD. There is no password, no
 * signup, no session security: anyone can pick any persona from a dropdown. It
 * exists to show what the app looks like when a human owns agents — who owns
 * what, what they've earned, what they've posted. Never present it as real auth,
 * and never let a judge believe we built a login system. We didn't, on purpose:
 * real signup would have meant an email-confirmation round trip on Supabase's
 * rate-limited SMTP, which is exactly the kind of dead end that kills a live
 * demo — and it adds nothing to the thing being demonstrated.
 *
 * WHAT AN ACCOUNT IS: a human who OWNS worker agents. It is not a new party to
 * the transaction. The agents still claim, work, and get paid on their own. This
 * is a visibility layer on top of the autonomous flow, never a step inside it —
 * which is what keeps the project in the Agentic Economy track.
 *
 * THE DATA ON THE POPULATED ACCOUNTS IS REAL. Maya owns alice and Tom owns bob;
 * those agents genuinely did the work on the board and genuinely hold settled
 * USDC in their own Circle wallets. Nothing about their history is invented — we
 * are attributing real agents to a persona, not fabricating a track record.
 *
 * The three empty accounts are empty on purpose: a judge should be able to see
 * what a brand-new account looks like before it owns anything.
 *
 * Every human still spends from the SAME shared server funder wallet ("TaskMesh
 * Test Wallet"). Nobody gets a personal wallet — see PROJECT_NOTES for why that
 * was considered and rejected.
 */

export interface DemoAccount {
  id: string;
  name: string;
  email: string;
  /** Worker agents this person runs. Empty = a new account that owns nothing. */
  agents: string[];
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "maya",
    name: "Maya Chen",
    email: "maya@taskmesh.demo",
    agents: ["alice"],
  },
  {
    id: "tom",
    name: "Tom Okafor",
    email: "tom@taskmesh.demo",
    agents: ["bob"],
  },
  // The rest own nothing yet — this is what a new account looks like.
  { id: "priya", name: "Priya Raman", email: "priya@taskmesh.demo", agents: [] },
  { id: "luis", name: "Luis Ferreira", email: "luis@taskmesh.demo", agents: [] },
  { id: "sara", name: "Sara Lindqvist", email: "sara@taskmesh.demo", agents: [] },
];

/** The cookie the persona picker sets. Readable by the server routes. */
export const ACCOUNT_COOKIE = "taskmesh_account";

export function findAccount(id: string | undefined): DemoAccount | null {
  if (!id) return null;
  return DEMO_ACCOUNTS.find((a) => a.id === id) ?? null;
}
