import "server-only";

import { parseAiJson, runConfiguredAi } from "@/lib/server/ai";
import { safeFetchText } from "@/lib/server/safe-fetch";
import {
  assessPresence,
  buildResearchPrompt,
  emptyEvidence,
  normalizeCandidates,
  rankByOpportunity,
  readSiteEvidence,
  type BusinessCandidate,
  type ResearchBrief,
  type ResearchedBusiness,
  type SiteEvidence,
} from "@/lib/extensions/research";
import type { StoredSettings } from "@/lib/server/settings";

const VERIFY_CONCURRENCY = 4;

/**
 * Fetches a candidate's site so its presence is judged on what is actually
 * served, not on what the model claimed. A failed fetch is recorded as
 * unreachable rather than silently treated as "fine".
 */
async function verify(candidate: BusinessCandidate): Promise<SiteEvidence> {
  if (!candidate.website) return { ...emptyEvidence, checked: true };
  try {
    const { text, finalUrl } = await safeFetchText(candidate.website, {
      timeoutMs: 10_000,
      maxBytes: 1_500_000,
    });
    return readSiteEvidence(text, finalUrl);
  } catch (error) {
    // safeFetchText reports a non-OK response as "HTTP <status>". A site that
    // refuses bots tells us nothing about its quality, so it must not be
    // recorded as broken.
    const message = error instanceof Error ? error.message : "";
    const blocked = /HTTP (401|403|429)/.test(message);
    return { ...emptyEvidence, checked: true, reachable: false, blocked };
  }
}

async function verifyAll(candidates: BusinessCandidate[]) {
  const results: ResearchedBusiness[] = [];
  for (let index = 0; index < candidates.length; index += VERIFY_CONCURRENCY) {
    const batch = candidates.slice(index, index + VERIFY_CONCURRENCY);
    const evidence = await Promise.all(batch.map(verify));
    batch.forEach((candidate, offset) => {
      results.push({
        ...candidate,
        evidence: evidence[offset],
        presence: assessPresence(candidate, evidence[offset]),
      });
    });
  }
  return results;
}

export type ResearchRun = {
  ranAt: string;
  provider: string;
  model: string;
  brief: ResearchBrief;
  businesses: ResearchedBusiness[];
  errors: string[];
};

export async function researchLocalBusinesses(
  settings: StoredSettings,
  brief: ResearchBrief,
  exclude: string[] = [],
  now = new Date(),
): Promise<ResearchRun> {
  const result = await runConfiguredAi(settings, {
    prompt: buildResearchPrompt(brief, exclude),
    webSearch: true,
    maxOutputTokens: 4_000,
  });

  const errors: string[] = [];
  let candidates: BusinessCandidate[] = [];
  try {
    candidates = normalizeCandidates(parseAiJson(result.text));
  } catch {
    errors.push(
      "The model did not return usable JSON. Try narrowing the category or running it again.",
    );
  }
  if (!candidates.length && !errors.length)
    errors.push("No businesses matched that brief.");

  return {
    ranAt: now.toISOString(),
    provider: result.provider,
    model: result.model,
    brief,
    businesses: rankByOpportunity(await verifyAll(candidates)),
    errors,
  };
}
