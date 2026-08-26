import type {
  GithubExtensionSettings,
  GithubItem,
  GithubItemKind,
} from "@/lib/extensions/types";

/**
 * Pure GitHub logic: query construction, response normalization, and the local
 * importance model. Kept free of network and server-only imports so the whole
 * ranking path is testable with plain fixtures.
 */

const URGENT_LABEL = /\b(urgent|critical|blocker|p0|security|hotfix)\b/i;

export type GithubQuery = { kind: GithubItemKind; q: string };

/** GitHub logins are alphanumeric with single hyphens, 39 characters max. */
export function isGithubLogin(value: string) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(value);
}

/**
 * Accepts `owner/name`. Everything interpolated into a search query passes
 * through here first, so a value containing a space or a qualifier character
 * cannot smuggle extra syntax into the query.
 */
export function isRepositorySlug(value: string) {
  const [owner, name, ...rest] = value.split("/");
  if (rest.length || !owner || !name) return false;
  return isGithubLogin(owner) && /^[A-Za-z0-9._-]{1,100}$/.test(name);
}

/** Normalizes pasted repository URLs down to `owner/name`, rejecting junk. */
export function cleanRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const slug = (typeof entry === "string" ? entry : "")
      .trim()
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
    if (!slug) continue;
    if (!isRepositorySlug(slug))
      throw new Error(`"${slug}" is not a valid owner/repository name.`);
    if (seen.size >= 50) throw new Error("Track at most 50 repositories.");
    seen.add(slug);
  }
  return [...seen];
}

/**
 * GitHub search treats unescaped qualifiers as syntax, so every interpolated
 * value is validated upstream in settings and re-checked here. A repo list is
 * expressed as an OR group rather than one request per repository.
 */
export function buildSearchQueries(
  settings: GithubExtensionSettings,
): GithubQuery[] {
  const login = settings.login.trim();
  if (!login) return [];
  const scope = settings.repositories.length
    ? ` ${settings.repositories.map((slug) => `repo:${slug}`).join(" ")}`
    : "";
  const queries: GithubQuery[] = [];
  if (settings.includeReviewRequests)
    queries.push({
      kind: "review-request",
      q: `is:open is:pr review-requested:${login}${scope}`,
    });
  if (settings.includeAssignedIssues)
    queries.push({
      kind: "assigned-issue",
      q: `is:open assignee:${login}${scope}`,
    });
  if (settings.includeMentions)
    queries.push({ kind: "mention", q: `is:open mentions:${login}${scope}` });
  return queries;
}

/**
 * `https://api.github.com/repos/owner/name` -> `owner/name`.
 *
 * Search results carry no trailing slash, so the separator must be optional;
 * requiring it silently fell through to the html_url fallback on every item.
 */
function repositoryFromApiUrl(value: unknown) {
  const match = /\/repos\/([^/]+\/[^/]+?)(?:\/|$)/.exec(
    typeof value === "string" ? value : "",
  );
  return match ? match[1] : "";
}

function hoursBetween(later: number, earlier: number) {
  return Math.max(0, Math.floor((later - earlier) / 3_600_000));
}

/**
 * Deterministic attention scoring. A review request blocks somebody else, so it
 * outranks work only you are waiting on; staleness escalates that further.
 * Drafts are penalised because they are usually not actually ready for review.
 */
export function scoreItem(
  item: Pick<GithubItem, "kind" | "isDraft" | "staleHours" | "labels" | "commentCount">,
): { priorityScore: number; priorityReason: string } {
  const reasons: string[] = [];
  let score =
    item.kind === "review-request" ? 70 : item.kind === "assigned-issue" ? 55 : 40;
  reasons.push(
    item.kind === "review-request"
      ? "Review requested from you"
      : item.kind === "assigned-issue"
        ? "Assigned to you"
        : "You were mentioned",
  );

  if (item.kind === "review-request" && item.staleHours >= 24) {
    const escalation = Math.min(20, Math.floor(item.staleHours / 24) * 7);
    score += escalation;
    reasons.push(`waiting ${Math.floor(item.staleHours / 24)}d`);
  }
  if (item.isDraft) {
    score -= 25;
    reasons.push("draft");
  }
  if (item.labels.some((label) => URGENT_LABEL.test(label))) {
    score += 15;
    reasons.push("urgent label");
  }
  if (item.commentCount >= 10) {
    score += 5;
    reasons.push("active discussion");
  }
  return {
    priorityScore: Math.max(0, Math.min(100, score)),
    priorityReason: reasons.join(" · "),
  };
}

type SearchItem = Record<string, unknown>;

export function normalizeSearchItems(
  payload: unknown,
  kind: GithubItemKind,
  now = new Date(),
): GithubItem[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as SearchItem;
    const url = typeof raw.html_url === "string" ? raw.html_url : "";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!url || !title) return [];
    const updatedAt =
      typeof raw.updated_at === "string" ? raw.updated_at : "";
    const updatedMs = Date.parse(updatedAt);
    const labels = Array.isArray(raw.labels)
      ? raw.labels.flatMap((label) =>
          label && typeof label === "object" &&
          typeof (label as { name?: unknown }).name === "string"
            ? [(label as { name: string }).name]
            : [],
        )
      : [];
    const base = {
      kind,
      isDraft: raw.draft === true,
      staleHours: Number.isFinite(updatedMs)
        ? hoursBetween(now.getTime(), updatedMs)
        : 0,
      labels,
      commentCount:
        typeof raw.comments === "number" && Number.isFinite(raw.comments)
          ? raw.comments
          : 0,
    };
    return [{
      id: `${kind}:${url}`,
      title,
      url,
      repository:
        repositoryFromApiUrl(raw.repository_url) ||
        url.split("/").slice(3, 5).join("/"),
      number:
        typeof raw.number === "number" && Number.isFinite(raw.number)
          ? raw.number
          : 0,
      author:
        raw.user && typeof raw.user === "object" &&
        typeof (raw.user as { login?: unknown }).login === "string"
          ? (raw.user as { login: string }).login
          : "",
      createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
      updatedAt,
      ...base,
      ...scoreItem(base),
    }];
  });
}

/**
 * The same pull request can arrive from several queries (assigned *and*
 * mentioned). Keep the highest-scoring copy so the strongest reason wins.
 */
export function mergeAndRank(groups: GithubItem[][]): GithubItem[] {
  const byUrl = new Map<string, GithubItem>();
  for (const item of groups.flat()) {
    const existing = byUrl.get(item.url);
    if (!existing || item.priorityScore > existing.priorityScore)
      byUrl.set(item.url, item);
  }
  return [...byUrl.values()].sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.url.localeCompare(b.url),
  );
}
