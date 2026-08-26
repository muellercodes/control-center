"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  GitPullRequestDraft,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type {
  GithubFeedResponse,
  GithubItem,
  PublicExtensionSettings,
} from "@/lib/extensions/types";
import styles from "./github-view.module.css";
import {
  Label,
  PageHeading,
  Panel,
  formatRelative,
  useExtensionFeed,
} from "./shared";

type Draft = {
  login: string;
  repositories: string;
  token: string;
  includeReviewRequests: boolean;
  includeAssignedIssues: boolean;
  includeMentions: boolean;
};

function draftFrom(settings: PublicExtensionSettings): Draft {
  return {
    login: settings.github.login,
    repositories: settings.github.repositories.join("\n"),
    token: "",
    includeReviewRequests: settings.github.includeReviewRequests,
    includeAssignedIssues: settings.github.includeAssignedIssues,
    includeMentions: settings.github.includeMentions,
  };
}

function kindLabel(item: GithubItem) {
  if (item.kind === "review-request") return "Review requested";
  if (item.kind === "assigned-issue") return "Assigned";
  return "Mentioned";
}

function KindIcon({ item }: { item: GithubItem }) {
  if (item.kind === "assigned-issue") return <CircleDot size={13} />;
  return item.isDraft ? (
    <GitPullRequestDraft size={13} />
  ) : (
    <GitPullRequest size={13} />
  );
}

function GithubSettingsForm({
  settings,
  onSaved,
}: {
  settings: PublicExtensionSettings;
  onSaved: (next: PublicExtensionSettings) => void;
}) {
  // Seeded once from props; the parent remounts this form with a fresh `key`
  // after every save, which is cheaper and safer than syncing in an effect.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/extensions/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          github: {
            login: draft.login.trim(),
            repositories: draft.repositories
              .split(/[\s,]+/)
              .map((entry) => entry.trim())
              .filter(Boolean),
            includeReviewRequests: draft.includeReviewRequests,
            includeAssignedIssues: draft.includeAssignedIssues,
            includeMentions: draft.includeMentions,
            ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save.");
      setDraft((current) => ({ ...current, token: "" }));
      onSaved(payload as PublicExtensionSettings);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save.",
      );
    } finally {
      setSaving(false);
    }
  };

  const tokenSource = settings.github.tokenSource;

  return (
    <Panel className="settings-panel reveal">
      <form onSubmit={save}>
        <div className="settings-field">
          <label htmlFor="github-login">GitHub username</label>
          <input
            id="github-login"
            value={draft.login}
            placeholder="muellercodes"
            autoComplete="off"
            onChange={(event) =>
              setDraft((current) => ({ ...current, login: event.target.value }))
            }
          />
          <p className="fine-print">
            Review requests, assignments, and mentions are searched for this
            account.
          </p>
        </div>

        <div className="settings-field">
          <label htmlFor="github-token">Personal access token</label>
          <input
            id="github-token"
            type="password"
            value={draft.token}
            autoComplete="off"
            placeholder={
              tokenSource === "none"
                ? "ghp_… (needs repo scope for private repositories)"
                : `Saved — from ${tokenSource}. Type a new token to replace it.`
            }
            onChange={(event) =>
              setDraft((current) => ({ ...current, token: event.target.value }))
            }
          />
          <p className="fine-print">
            Stored locally in <code>extensions.json</code>, owner-readable only,
            and never returned by the API. <code>GITHUB_TOKEN</code> in
            <code> .env.local</code> works too.
          </p>
        </div>

        <div className="settings-field">
          <label htmlFor="github-repositories">
            Limit to repositories (optional)
          </label>
          <textarea
            id="github-repositories"
            rows={3}
            value={draft.repositories}
            placeholder={"owner/name\nowner/other-repo"}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                repositories: event.target.value,
              }))
            }
          />
          <p className="fine-print">
            One per line. Leave empty to search everything the token can see.
          </p>
        </div>

        {(
          [
            [
              "includeReviewRequests",
              "Pull requests awaiting my review",
              "Somebody is blocked on you. Ranked highest, and escalated the longer it waits.",
            ],
            [
              "includeAssignedIssues",
              "Issues and pull requests assigned to me",
              "Work that is yours to finish, whoever opened it.",
            ],
            [
              "includeMentions",
              "Threads that mention me",
              "Noisier: any open thread with your username in it.",
            ],
          ] as const
        ).map(([key, title, description]) => (
          <label className="toggle-row" key={key}>
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [key]: event.target.checked,
                }))
              }
            />
            <span>
              <b>{title}</b>
              <small>{description}</small>
            </span>
          </label>
        ))}

        {error && <p className="error-notice">{error}</p>}

        <button className="button button-primary" disabled={saving}>
          {saving ? "Saving…" : "Save GitHub settings"}
        </button>
      </form>
    </Panel>
  );
}

export function GithubView() {
  const feed = useExtensionFeed<GithubFeedResponse>(
    "/api/live/github",
    "/api/live/github?refresh=1",
  );
  const [settings, setSettings] = useState<PublicExtensionSettings | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void fetch("/api/extensions/settings", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setSettings(payload))
      .catch(() => undefined);
  }, []);

  const items = feed.data?.items ?? [];
  const configured = Boolean(settings?.github.login && settings.github.tokenSet);

  return (
    <div className="view">
      <PageHeading
        eyebrow="Extension"
        title="GitHub"
        description="Open pull requests, assignments, and mentions ranked by how long somebody has been waiting on you."
        action={
          <div className="top-actions">
            <button
              className="button"
              onClick={() => setShowSettings((value) => !value)}
            >
              <Settings2 size={15} /> {showSettings ? "Hide setup" : "Setup"}
            </button>
            <button
              className="button button-primary"
              disabled={feed.loading}
              onClick={() => void feed.refresh()}
            >
              <RefreshCw size={15} className={feed.loading ? "spin" : ""} />
              Refresh
            </button>
          </div>
        }
      />

      {settings && (showSettings || !configured) && (
        <GithubSettingsForm
          key={settingsVersion}
          settings={settings}
          onSaved={(next) => {
            setSettings(next);
            setSettingsVersion((value) => value + 1);
            setShowSettings(false);
            void feed.refresh();
          }}
        />
      )}

      {feed.error && <p className="error-notice">{feed.error}</p>}
      {feed.data?.errors?.map((message) => (
        <p className="error-notice" key={message}>
          {message}
        </p>
      ))}
      {feed.data?.rateLimited && (
        <p className="error-notice">
          GitHub rate-limited this check. The previous results are still shown.
        </p>
      )}

      <div className="story-stack reveal delay-2">
        {items.map((item, index) => (
          <article className="story-card" key={item.id}>
            <div className="story-index">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="story-body">
              <div className="story-meta">
                <span>{item.repository}</span>
                <i />
                <span>{formatRelative(item.updatedAt)}</span>
                <Label
                  tone={item.kind === "review-request" ? "positive" : "brief"}
                >
                  <KindIcon item={item} /> {kindLabel(item)}
                </Label>
                <Label tone="verified">{item.priorityScore} priority</Label>
                {item.isDraft && <Label tone="watch">Draft</Label>}
              </div>
              <h2>
                {item.title}{" "}
                <span className={styles.number}>#{item.number}</span>
              </h2>
              <p>{item.priorityReason}</p>
              <div className="story-footer">
                <span>{item.author ? `Opened by ${item.author}` : ""}</span>
                <div>
                  <a
                    className="round-link"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open on GitHub"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>
            </div>
          </article>
        ))}

        {!items.length && !feed.loading && (
          <Panel className="empty-state">
            <CheckCircle2 size={24} />
            <h2>{configured ? "Nothing waiting on you" : "GitHub is not set up yet"}</h2>
            <p>
              {configured
                ? "No open pull requests, assignments, or mentions need your attention right now."
                : "Add your GitHub username and a personal access token above to start collecting."}
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
