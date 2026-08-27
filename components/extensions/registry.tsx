"use client";

import { GitPullRequest, Telescope } from "lucide-react";
import { GithubView } from "./github-view";
import { ResearchView } from "./research-view";

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
    id: "research",
    label: "Research",
    icon: Telescope,
    View: ResearchView,
  },
] as const satisfies readonly ExtensionTab[];

export type ExtensionTabId = (typeof extensionTabs)[number]["id"];
