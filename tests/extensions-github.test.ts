import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchQueries,
  mergeAndRank,
  cleanRepositories,
  isGithubLogin,
  isRepositorySlug,
  normalizeSearchItems,
  scoreItem,
} from "../lib/extensions/github";
import type { GithubExtensionSettings } from "../lib/extensions/types";

const baseSettings: GithubExtensionSettings = {
  login: "muellercodes",
  repositories: [],
  includeReviewRequests: true,
  includeAssignedIssues: true,
  includeMentions: false,
};

test("builds only the enabled queries", () => {
  const queries = buildSearchQueries(baseSettings);
  assert.deepEqual(queries.map((query) => query.kind), [
    "review-request",
    "assigned-issue",
  ]);
  assert.equal(
    queries[0].q,
    "is:open is:pr review-requested:muellercodes",
  );
});

test("produces no queries without a login", () => {
  assert.deepEqual(buildSearchQueries({ ...baseSettings, login: "" }), []);
});

test("scopes queries to configured repositories", () => {
  const [review] = buildSearchQueries({
    ...baseSettings,
    repositories: ["muellercodes/control-center", "muellercodes/journal"],
    includeAssignedIssues: false,
  });
  assert.equal(
    review.q,
    "is:open is:pr review-requested:muellercodes repo:muellercodes/control-center repo:muellercodes/journal",
  );
});

test("review requests outrank assignments, and staleness escalates", () => {
  const fresh = scoreItem({
    kind: "review-request",
    isDraft: false,
    staleHours: 1,
    labels: [],
    commentCount: 0,
  });
  const stale = scoreItem({
    kind: "review-request",
    isDraft: false,
    staleHours: 72,
    labels: [],
    commentCount: 0,
  });
  const assigned = scoreItem({
    kind: "assigned-issue",
    isDraft: false,
    staleHours: 1,
    labels: [],
    commentCount: 0,
  });
  assert.ok(fresh.priorityScore > assigned.priorityScore);
  assert.ok(stale.priorityScore > fresh.priorityScore);
  assert.match(stale.priorityReason, /waiting 3d/);
});

test("drafts are demoted and urgent labels promoted", () => {
  const draft = scoreItem({
    kind: "review-request",
    isDraft: true,
    staleHours: 0,
    labels: [],
    commentCount: 0,
  });
  const urgent = scoreItem({
    kind: "review-request",
    isDraft: false,
    staleHours: 0,
    labels: ["security"],
    commentCount: 0,
  });
  assert.equal(draft.priorityScore, 45);
  assert.equal(urgent.priorityScore, 85);
  assert.match(draft.priorityReason, /draft/);
});

test("scores stay inside 0-100", () => {
  const maxed = scoreItem({
    kind: "review-request",
    isDraft: false,
    staleHours: 24 * 90,
    labels: ["critical", "p0"],
    commentCount: 200,
  });
  assert.ok(maxed.priorityScore <= 100);
});

const now = new Date("2026-08-26T12:00:00.000Z");

test("normalizes search payloads and skips malformed entries", () => {
  const items = normalizeSearchItems(
    {
      items: [
        {
          html_url: "https://github.com/muellercodes/control-center/pull/7",
          repository_url:
            "https://api.github.com/repos/muellercodes/control-center",
          title: "  Add GitHub extension  ",
          number: 7,
          user: { login: "someone" },
          created_at: "2026-08-24T12:00:00.000Z",
          updated_at: "2026-08-25T12:00:00.000Z",
          comments: 3,
          labels: [{ name: "enhancement" }, { nope: true }],
          draft: false,
        },
        { html_url: "", title: "no url" },
        { html_url: "https://example.com/x", title: "" },
        "not an object",
      ],
    },
    "review-request",
    now,
  );
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.title, "Add GitHub extension");
  assert.equal(item.repository, "muellercodes/control-center");
  assert.equal(item.author, "someone");
  assert.equal(item.staleHours, 24);
  assert.deepEqual(item.labels, ["enhancement"]);
});

test("tolerates a payload without an items array", () => {
  assert.deepEqual(normalizeSearchItems({ message: "Bad credentials" }, "mention"), []);
  assert.deepEqual(normalizeSearchItems(null, "mention"), []);
});

test("deduplicates across queries keeping the strongest reason", () => {
  const url = "https://github.com/muellercodes/control-center/pull/9";
  const payload = (updated: string) => ({
    items: [
      {
        html_url: url,
        repository_url:
          "https://api.github.com/repos/muellercodes/control-center",
        title: "Shared item",
        number: 9,
        user: { login: "someone" },
        updated_at: updated,
        comments: 0,
        labels: [],
      },
    ],
  });
  const merged = mergeAndRank([
    normalizeSearchItems(payload("2026-08-26T11:00:00.000Z"), "mention", now),
    normalizeSearchItems(
      payload("2026-08-26T11:00:00.000Z"),
      "review-request",
      now,
    ),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, "review-request");
});

test("ranks highest priority first", () => {
  const build = (kind: "review-request" | "mention", number: number) =>
    normalizeSearchItems(
      {
        items: [
          {
            html_url: `https://github.com/muellercodes/control-center/pull/${number}`,
            repository_url:
              "https://api.github.com/repos/muellercodes/control-center",
            title: `Item ${number}`,
            number,
            user: { login: "someone" },
            updated_at: "2026-08-26T11:00:00.000Z",
            comments: 0,
            labels: [],
          },
        ],
      },
      kind,
      now,
    );
  const ranked = mergeAndRank([build("mention", 1), build("review-request", 2)]);
  assert.deepEqual(
    ranked.map((item) => item.number),
    [2, 1],
  );
});

test("accepts real logins and rejects query-breaking ones", () => {
  for (const login of ["muellercodes", "a", "a-b-c", "A1"])
    assert.equal(isGithubLogin(login), true, login);
  for (const login of ["-lead", "trail-", "a--b", "has space", "a".repeat(40), "user:x", ""])
    assert.equal(isGithubLogin(login), false, login);
});

test("normalizes repository URLs down to owner/name", () => {
  assert.deepEqual(
    cleanRepositories([
      "https://github.com/muellercodes/control-center",
      "muellercodes/journal.git",
      "muellercodes/pedigree/",
      "  ",
    ]),
    [
      "muellercodes/control-center",
      "muellercodes/journal",
      "muellercodes/pedigree",
    ],
  );
});

test("deduplicates repositories and rejects malformed slugs", () => {
  assert.deepEqual(
    cleanRepositories(["muellercodes/journal", "muellercodes/journal"]),
    ["muellercodes/journal"],
  );
  assert.throws(() => cleanRepositories(["not-a-slug"]), /not a valid/);
  assert.throws(() => cleanRepositories(["owner/name extra"]), /not a valid/);
  assert.throws(
    () => cleanRepositories(["owner/a/b"]),
    /not a valid/,
  );
});

test("refuses more than fifty repositories", () => {
  const many = Array.from({ length: 51 }, (_, index) => `owner/repo-${index}`);
  assert.throws(() => cleanRepositories(many), /at most 50/);
});

test("isRepositorySlug rejects values that could extend a search query", () => {
  assert.equal(isRepositorySlug("owner/name"), true);
  assert.equal(isRepositorySlug("owner/name is:open"), false);
  assert.equal(isRepositorySlug("owner"), false);
});

test("reads the repository from repository_url rather than the browser URL", () => {
  // repository_url in real search results carries no trailing slash. The
  // html_url here would yield a different owner/name through the fallback, so
  // this fails if the regex stops matching the live shape.
  const [item] = normalizeSearchItems(
    {
      items: [
        {
          html_url: "https://github.example.com/other/project/pull/3",
          repository_url:
            "https://api.github.com/repos/muellercodes/control-center",
          title: "Regression guard",
          number: 3,
          updated_at: "2026-08-26T11:00:00.000Z",
          comments: 0,
          labels: [],
        },
      ],
    },
    "review-request",
    now,
  );
  assert.equal(item.repository, "muellercodes/control-center");
});
