/**
 * Local business research: prompt construction, candidate normalization, and
 * the web-presence model.
 *
 * The AI proposes candidates; it never gets the last word. Every candidate is
 * re-checked by fetching its actual site, and the presence score is computed
 * from what that fetch found rather than from anything the model asserted.
 * This mirrors how the Mentions collector already treats model output: useful
 * for discovery, never accepted as evidence.
 */

export type BusinessCandidate = {
  id: string;
  name: string;
  category: string;
  town: string;
  website: string;
  instagram: string;
  facebook: string;
  /** The model's reason this place is worth a visit. Opinion, labelled as such. */
  note: string;
};

export type SiteEvidence = {
  checked: boolean;
  reachable: boolean;
  /** The site answered, but refused an automated request (401/403/429). */
  blocked: boolean;
  finalUrl: string;
  https: boolean;
  mobileReady: boolean;
  hasContactLink: boolean;
  builder: string;
  staleYear: number | null;
  title: string;
};

export type PresenceAssessment = {
  /** 0 = strong web presence, 100 = essentially none. */
  gapScore: number;
  reasons: string[];
  verdict: "unknown" | "blocked" | "unreachable" | "needs-work" | "solid";
};

export type ResearchedBusiness = BusinessCandidate & {
  evidence: SiteEvidence;
  presence: PresenceAssessment;
};

export type ResearchBrief = {
  towns: string[];
  category: string;
  criteria: string;
};

const MAX_CANDIDATES = 10;

export function briefIsUsable(brief: ResearchBrief) {
  return brief.towns.filter((town) => town.trim()).length > 0;
}

export function buildResearchPrompt(brief: ResearchBrief, exclude: string[] = []) {
  const towns = brief.towns.filter((town) => town.trim()).join(", ");
  const category = brief.category.trim() || "any independent local business";
  const criteria = brief.criteria.trim();
  return [
    `Find up to ${MAX_CANDIDATES} independent, locally-owned businesses in or near ${towns} (Maine, USA).`,
    `Category focus: ${category}.`,
    criteria ? `Additional criteria: ${criteria}` : "",
    exclude.length
      ? `Skip these, they are already known: ${exclude.slice(0, 60).join("; ")}.`
      : "",
    "",
    "Use web search. Rules:",
    "- Only include businesses you found actual evidence for. Never invent a business, a website, or a social handle.",
    "- Prefer independent owner-operated places over chains and franchises.",
    "- If you cannot find a website for a business, return an empty string for website rather than guessing a URL.",
    "- Do not guess social handles from the business name; leave them empty unless you saw them.",
    "- The note should say what makes the place distinctive in one sentence, and must be grounded in something you actually read.",
    "",
    "Return ONLY a JSON object of this exact shape, with no commentary:",
    '{"businesses":[{"name":"","category":"","town":"","website":"","instagram":"","facebook":"","note":""}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepts only http(s) URLs, so a hallucinated scheme cannot be fetched. */
export function cleanWebsite(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (!url.hostname.includes(".")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * Models return social handles inconsistently: bare, @-prefixed, or as a full
 * profile URL. Everything is reduced to the bare handle so the UI can build one
 * canonical link instead of rendering "@https://instagram.com/...".
 */
export function cleanHandle(value: unknown, host: string) {
  let handle = text(value);
  if (!handle) return "";
  const urlMatch = new RegExp(`${host}/([^/?#\\s]+)`, "i").exec(handle);
  if (urlMatch) handle = urlMatch[1];
  handle = handle.replace(/^@/, "").replace(/[/?#].*$/, "").trim();
  return /^[A-Za-z0-9._-]{1,60}$/.test(handle) ? handle : "";
}

export function slugId(name: string, town: string) {
  return `${name}|${town}`
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeCandidates(payload: unknown): BusinessCandidate[] {
  const list = (payload as { businesses?: unknown })?.businesses;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const name = text(raw.name);
    const town = text(raw.town);
    if (!name) return [];
    const id = slugId(name, town);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      category: text(raw.category),
      town,
      website: cleanWebsite(raw.website),
      instagram: cleanHandle(raw.instagram, "instagram\\.com"),
      facebook: cleanHandle(raw.facebook, "facebook\\.com"),
      note: text(raw.note),
    }];
  }).slice(0, MAX_CANDIDATES);
}

export const emptyEvidence: SiteEvidence = {
  checked: false,
  reachable: false,
  blocked: false,
  finalUrl: "",
  https: false,
  mobileReady: false,
  hasContactLink: false,
  builder: "",
  staleYear: null,
  title: "",
};

const BUILDERS: Array<[RegExp, string]> = [
  [/wix\.com|wixstatic/i, "Wix"],
  [/squarespace/i, "Squarespace"],
  [/shopify/i, "Shopify"],
  [/wordpress/i, "WordPress"],
  [/godaddy|websitebuilder/i, "GoDaddy"],
  [/weebly/i, "Weebly"],
];

export function readSiteEvidence(
  html: string,
  finalUrl: string,
  now = new Date(),
): SiteEvidence {
  const builder = BUILDERS.find(([pattern]) => pattern.test(html))?.[1] ?? "";
  const years = [...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}(20\d{2})/gi)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 2000 && year <= now.getFullYear());
  const newestYear = years.length ? Math.max(...years) : null;
  return {
    checked: true,
    reachable: true,
    blocked: false,
    finalUrl,
    https: finalUrl.startsWith("https://"),
    mobileReady: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasContactLink: /href=["'](tel:|mailto:)/i.test(html),
    builder,
    // Only counts as stale if a copyright year was actually found.
    staleYear:
      newestYear !== null && now.getFullYear() - newestYear >= 2 ? newestYear : null,
    title: (html.match(/<title[^>]*>([^<]{0,160})<\/title>/i)?.[1] ?? "").trim(),
  };
}

/**
 * How much room there is to improve this business's web presence.
 *
 * This is context for deciding where you could genuinely be useful — not a
 * qualification score, and not a reason to pitch anyone. A spotlight is
 * unconditional either way.
 */
export function assessPresence(
  candidate: Pick<BusinessCandidate, "website">,
  evidence: SiteEvidence,
): PresenceAssessment {
  // A search that surfaced no website is not proof there isn't one — verified
  // against a real business whose live site the search simply missed. Reporting
  // that as a certain gap would be the same false-zero this app refuses to
  // print for a blocked follower count.
  if (!candidate.website)
    return {
      gapScore: 50,
      reasons: ["No site found by the search — confirm before assuming there isn't one"],
      verdict: "unknown",
    };
  if (evidence.checked && evidence.blocked)
    return {
      gapScore: 0,
      reasons: ["Site refused the automated check, so nothing was assessed"],
      verdict: "blocked",
    };
  if (evidence.checked && !evidence.reachable)
    return {
      gapScore: 85,
      reasons: ["Website did not respond"],
      verdict: "unreachable",
    };
  if (!evidence.checked)
    return { gapScore: 0, reasons: ["Not checked yet"], verdict: "solid" };

  const reasons: string[] = [];
  let score = 0;
  if (!evidence.mobileReady) {
    score += 30;
    reasons.push("No mobile viewport — likely broken on phones");
  }
  if (!evidence.https) {
    score += 20;
    reasons.push("No HTTPS");
  }
  if (evidence.staleYear !== null) {
    score += 15;
    reasons.push(`Copyright still reads ${evidence.staleYear}`);
  }
  if (!evidence.hasContactLink) {
    score += 15;
    reasons.push("No tappable phone or email link");
  }
  if (evidence.builder) {
    score += 5;
    reasons.push(`Template site (${evidence.builder})`);
  }
  if (!reasons.length) reasons.push("Site looks well maintained");
  return {
    gapScore: Math.min(100, score),
    reasons,
    verdict: score >= 30 ? "needs-work" : "solid",
  };
}

/** Biggest opportunity first, then alphabetically for a stable order. */
export function rankByOpportunity(items: ResearchedBusiness[]) {
  return [...items].sort(
    (a, b) =>
      b.presence.gapScore - a.presence.gapScore || a.name.localeCompare(b.name),
  );
}
