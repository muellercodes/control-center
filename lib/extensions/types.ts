/**
 * Types for locally-added extensions.
 *
 * Extensions deliberately own their own settings file, SQLite table, API
 * routes, and UI so that adding one touches as little of the upstream tree as
 * possible. Only `control-center.tsx`, `scheduler.ts`, and `database.ts` carry
 * a hook, and each hook is a single line.
 */

export type GithubItemKind = "review-request" | "assigned-issue" | "mention";

export type GithubItem = {
  id: string;
  kind: GithubItemKind;
  title: string;
  url: string;
  repository: string;
  number: number;
  author: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  labels: string[];
  /** Whole hours since the item was last updated, at collection time. */
  staleHours: number;
  priorityScore: number;
  priorityReason: string;
};

export type GithubFeedResponse = {
  configured: boolean;
  checkedAt: string;
  items: GithubItem[];
  errors: string[];
  /** Set when GitHub refused a query for quota rather than for content. */
  rateLimited?: boolean;
};

export type GithubExtensionSettings = {
  login: string;
  /** Empty means "every repository the token can see". */
  repositories: string[];
  includeReviewRequests: boolean;
  includeAssignedIssues: boolean;
  includeMentions: boolean;
};

export type ExtensionSettings = {
  github: GithubExtensionSettings;
};

/** What the API returns: identical, plus token presence but never the token. */
export type PublicExtensionSettings = {
  github: GithubExtensionSettings & {
    tokenSet: boolean;
    tokenSource: "none" | "settings" | "environment";
  };
};

export type ExtensionSettingsUpdate = {
  github: GithubExtensionSettings & {
    token?: string;
    clearToken?: boolean;
  };
};

export const emptyExtensionSettings: ExtensionSettings = {
  github: {
    login: "",
    repositories: [],
    includeReviewRequests: true,
    includeAssignedIssues: true,
    includeMentions: false,
  },
};
