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

export type CalendarExtensionSettings = {
  googleClientId: string;
  /** Empty means "just the primary calendar". */
  calendarIds: string[];
  workingHours: { startMinute: number; endMinute: number; days: number[] };
  minimumBlockMinutes: number;
  contextSwitchMinutes: number;
  allDayBlocksDay: boolean;
};

export type CalendarDay = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  busy: Array<{
    start: string;
    end: string;
    title: string;
    allDay: boolean;
    response?: "accepted" | "tentative" | "declined" | "needsAction";
  }>;
  freeWindows: Array<{ start: string; end: string; minutes: number }>;
  capacityMinutes: number;
};

export type CalendarFeedResponse = {
  configured: boolean;
  connected: boolean;
  connectedEmail?: string;
  checkedAt: string;
  days: CalendarDay[];
  errors: string[];
};

export type ExtensionSettings = {
  github: GithubExtensionSettings;
  calendar: CalendarExtensionSettings;
};

/** What the API returns: identical, plus token presence but never the token. */
export type PublicExtensionSettings = {
  github: GithubExtensionSettings & {
    tokenSet: boolean;
    tokenSource: "none" | "settings" | "environment";
  };
  calendar: CalendarExtensionSettings & {
    googleClientSecretSet: boolean;
    connected: boolean;
    connectedEmail: string;
  };
};

export type ExtensionSettingsUpdate = {
  github: GithubExtensionSettings & {
    token?: string;
    clearToken?: boolean;
  };
  calendar: CalendarExtensionSettings & {
    googleClientSecret?: string;
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
  calendar: {
    googleClientId: "",
    calendarIds: [],
    workingHours: { startMinute: 9 * 60, endMinute: 17 * 60, days: [1, 2, 3, 4, 5] },
    minimumBlockMinutes: 25,
    contextSwitchMinutes: 5,
    allDayBlocksDay: false,
  },
};
