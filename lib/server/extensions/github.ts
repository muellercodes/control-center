import "server-only";

import { safeFetchText } from "@/lib/server/safe-fetch";
import {
  buildSearchQueries,
  mergeAndRank,
  normalizeSearchItems,
} from "@/lib/extensions/github";
import { configuredGithubToken } from "@/lib/extensions/settings";
import type { GithubFeedResponse, GithubItem } from "@/lib/extensions/types";
import type { readExtensionSettings } from "@/lib/extensions/settings";

type StoredExtensionSettings = Awaited<ReturnType<typeof readExtensionSettings>>;

const SEARCH_ENDPOINT = "https://api.github.com/search/issues";
const PER_PAGE = 50;

function isRateLimit(message: string) {
  return /HTTP (403|429)/.test(message);
}

export async function collectGithub(
  settings: StoredExtensionSettings,
  now = new Date(),
): Promise<GithubFeedResponse> {
  const checkedAt = now.toISOString();
  const queries = buildSearchQueries(settings.github);
  const token = configuredGithubToken(settings);

  if (!settings.github.login || !queries.length)
    return { configured: false, checkedAt, items: [], errors: [] };
  if (!token)
    return {
      configured: false,
      checkedAt,
      items: [],
      errors: [
        "Add a GitHub personal access token to collect review requests and issues.",
      ],
    };

  const errors: string[] = [];
  let rateLimited = false;

  const groups = await Promise.all(
    queries.map(async ({ kind, q }): Promise<GithubItem[]> => {
      const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&sort=updated&order=desc`;
      try {
        const { text } = await safeFetchText(url, {
          timeoutMs: 15_000,
          maxBytes: 2_000_000,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        return normalizeSearchItems(JSON.parse(text), kind, now);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown GitHub error.";
        if (isRateLimit(message)) rateLimited = true;
        // Report the gap rather than silently returning a short list, matching
        // how the upstream collectors surface partial coverage.
        errors.push(`${kind}: ${message}`);
        return [];
      }
    }),
  );

  return {
    configured: true,
    checkedAt,
    items: mergeAndRank(groups),
    errors,
    ...(rateLimited ? { rateLimited: true } : {}),
  };
}

/** Snapshot identity: re-collect from scratch whenever the watch set changes. */
export function githubScope(settings: StoredExtensionSettings) {
  return JSON.stringify({
    login: settings.github.login,
    repositories: settings.github.repositories,
    reviews: settings.github.includeReviewRequests,
    issues: settings.github.includeAssignedIssues,
    mentions: settings.github.includeMentions,
  });
}
