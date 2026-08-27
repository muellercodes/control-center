"use client";

import { CalendarClock, GitPullRequest } from "lucide-react";
import { CalendarView } from "./calendar-view";
import { GithubView } from "./github-view";

/**
 * The single place local tabs are declared.
 *
 * control-center.tsx consumes this in exactly three one-line hooks (the `Tab`
 * union, the `nav` array, and the render switch), so adding another tab later
 * means editing only this file plus the new view — no further churn in the
 * 3,700-line component that upstream rewrites most often.
 */
export type ExtensionTab = {
  id: string;
  label: string;
  icon: typeof GitPullRequest;
  View: React.ComponentType;
};

export const extensionTabs = [
  {
    id: "github",
    label: "GitHub",
    icon: GitPullRequest,
    View: GithubView,
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarClock,
    View: CalendarView,
  },
] as const satisfies readonly ExtensionTab[];

export type ExtensionTabId = (typeof extensionTabs)[number]["id"];
