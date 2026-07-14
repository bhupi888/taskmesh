/**
 * Curated real-world examples for the "Post a task" form.
 *
 * WHY THESE AND NOT INVENTED ONES: a judge should be able to ask "is this a real
 * problem or a demo prop?" and get a checkable answer. Each example below is an
 * anonymised composite of a documented, recurring real-world complaint pattern,
 * with a link to where that pattern is publicly documented.
 *
 * TWO RULES, both learned the hard way — do not break either when adding more.
 *
 * 1. ONLY TEXT THAT ITSELF NEEDS CONDENSING. Complaints, disputes, tickets,
 *    reviews, long threads. NEVER a job/gig posting ("write 5 blog posts",
 *    "edit my video"). TaskMesh's worker does exactly one thing to any input:
 *    it summarizes it. Feed it a job posting and the board would advertise
 *    "write blog posts" while the agent hands back a *summary of the posting* —
 *    incoherent, and it would imply TaskMesh fulfils real freelance gigs. It
 *    does not.
 *
 * 2. ANONYMISED COMPOSITE, NOT A QUOTE. The `source` names where the pattern is
 *    documented — it is NOT a claim that we scraped one person's post. Never
 *    copy an identifiable individual's wording. `source` is displayed on the
 *    board, so it has to survive being read literally.
 *
 * The bounty is NEVER sourced from these. It is always TaskMesh's own demo USDC
 * from its own funder wallet, set in the Bounty field like any other task, with
 * no connection to whatever money the original real-world situation involved.
 */

export interface TaskExample {
  label: string;
  category: string;
  /** Where the pattern is documented. Rendered on the board — keep it literal. */
  source: string;
  sourceUrl: string;
  text: string;
}

/** The categories a task can be filed under. Domains of work, not job types. */
export const CATEGORIES = [
  "Customer Support",
  "E-commerce Disputes",
  "Billing & Payments",
  "Product Feedback",
] as const;

export const EXAMPLES: TaskExample[] = [
  {
    label: "Delivery dispute — marked delivered, never arrived",
    category: "E-commerce Disputes",
    source: "Common dispute pattern — Amazon Seller Forums / Etsy Community",
    sourceUrl:
      "https://community.etsy.com/t5/Technical-Issues/Packages-delivered-but-customer-says-did-not-receive/td-p/141294378/",
    text:
      "I ordered a replacement filter on the 2nd. The tracking says it was delivered on the 5th but nothing ever arrived. " +
      "I checked with my neighbours and the building mailroom and nobody has it. The seller keeps telling me the carrier " +
      "scan proves it was delivered and is refusing a refund on that basis. I've ordered from them three times before " +
      "with no problems at all, which is why this is so frustrating. At this point I want either a replacement sent " +
      "signature-required, or a full refund — I don't really mind which, I just don't want to be told again that a scan " +
      "means I have the package when I don't.",
  },
  {
    label: "Subscription billed after cancellation",
    category: "Billing & Payments",
    source: "Common complaint pattern — FTC consumer alerts on subscription billing",
    sourceUrl:
      "https://consumer.ftc.gov/articles/what-know-about-free-trials-and-subscription-services",
    text:
      "I cancelled this subscription during the free trial, well before the renewal date, and I have the confirmation " +
      "email saying the cancellation went through. I was still charged the annual fee the following week. I contacted " +
      "support and was told the cancellation 'didn't complete' because I did it from the mobile app rather than the " +
      "website, which is not something anyone mentioned anywhere at any point. The confirmation email I was sent says " +
      "nothing about that either. I've now been waiting eleven days for a refund that two different agents have told me " +
      "was already processed. My bank shows nothing.",
  },
  {
    label: "Bug report — intermittent, only under one condition",
    category: "Customer Support",
    source: "Common support-ticket pattern — Stack Overflow / vendor forums",
    sourceUrl: "https://stackoverflow.com/questions/tagged/intermittent",
    text:
      "The app logs me out every few minutes, but only when I'm on cellular data — on wifi it's completely fine and I " +
      "can stay signed in all day. It started right after the 4.2 update; I never had this before. I've reinstalled " +
      "twice and signed in again each time, no difference. My colleague on the same phone model and the same carrier " +
      "isn't seeing it, but she hasn't taken the 4.2 update yet. It doesn't happen at a fixed interval either, it seems " +
      "to be when the app has been in the background for a bit and I come back to it.",
  },
  {
    label: "Negative review — the real complaint is buried",
    category: "Product Feedback",
    source: "Common review pattern — public product review sites",
    sourceUrl: "https://consumer.ftc.gov/consumer-alerts",
    text:
      "Been using this for about three months. The build quality is honestly fine, better than the price suggests, and " +
      "the battery lasts about as long as they claim. Setup took a while but that was partly me not reading the guide. " +
      "It looks good on a desk. The reason I'm only leaving two stars is that it silently drops its connection about " +
      "once a day and there's no notification when it does — you just find out later that nothing synced, and there's " +
      "no way to make it re-sync on demand, you have to power cycle it and wait. For something whose entire purpose is " +
      "syncing, that's not a minor annoyance, and none of the reviews I read mentioned it.",
  },
];
