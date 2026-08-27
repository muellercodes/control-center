import "server-only";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "@/lib/server/settings";
import {
  cleanRepositories,
  isGithubLogin,
  isRepositorySlug,
} from "@/lib/extensions/github";
import {
  emptyExtensionSettings,
  type ExtensionSettings,
  type ExtensionSettingsUpdate,
  type PublicExtensionSettings,
} from "@/lib/extensions/types";

/**
 * Extension config lives beside settings.json rather than inside it. Upstream
 * rewrites settings.json's shape often; keeping this separate means an upstream
 * merge never collides with local extension config, and an upstream version
 * that knows nothing about extensions simply ignores the file.
 */

type StoredExtensionSettings = ExtensionSettings & {
  github: ExtensionSettings["github"] & { token: string };
};

const storedDefaults: StoredExtensionSettings = {
  github: { ...emptyExtensionSettings.github, token: "" },
};

let writeQueue: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(operation: () => Promise<T>) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function extensionSettingsPath() {
  return path.join(dataDirectory(), "extensions.json");
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function cleanBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function readExtensionSettings(): Promise<StoredExtensionSettings> {
  try {
    const parsed = JSON.parse(
      await readFile(extensionSettingsPath(), "utf8"),
    ) as Partial<StoredExtensionSettings>;
    return {
      github: {
        ...storedDefaults.github,
        ...parsed.github,
        login: cleanText(parsed.github?.login),
        repositories: Array.isArray(parsed.github?.repositories)
          ? parsed.github.repositories.filter(
              (entry): entry is string =>
                typeof entry === "string" && isRepositorySlug(entry),
            )
          : [],
        token: cleanText(parsed.github?.token),
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return structuredClone(storedDefaults);
  }
}

async function writeUnlocked(settings: StoredExtensionSettings) {
  const directory = dataDirectory();
  const target = extensionSettingsPath();
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function writeExtensionSettings(settings: StoredExtensionSettings) {
  return serializeWrite(() => writeUnlocked(settings));
}

/** Settings token wins over the environment, matching how AI keys behave. */
export function configuredGithubToken(settings: StoredExtensionSettings) {
  return settings.github.token.trim() || process.env.GITHUB_TOKEN?.trim() || "";
}

export function toPublicExtensionSettings(
  settings: StoredExtensionSettings,
): PublicExtensionSettings {
  const fromSettings = Boolean(settings.github.token.trim());
  const fromEnvironment = Boolean(process.env.GITHUB_TOKEN?.trim());
  // Built field by field rather than by rest-destructuring the token away, so
  // a field added to the stored shape later cannot leak through by default.
  return {
    github: {
      login: settings.github.login,
      repositories: settings.github.repositories,
      includeReviewRequests: settings.github.includeReviewRequests,
      includeAssignedIssues: settings.github.includeAssignedIssues,
      includeMentions: settings.github.includeMentions,
      tokenSet: fromSettings || fromEnvironment,
      tokenSource: fromSettings
        ? "settings"
        : fromEnvironment
          ? "environment"
          : "none",
    },
  };
}

export async function applyExtensionSettingsUpdate(
  update: Partial<ExtensionSettingsUpdate>,
): Promise<PublicExtensionSettings> {
  const existing = await readExtensionSettings();
  const incoming = update.github;
  const login = cleanText(incoming?.login, existing.github.login).trim();
  if (login && !isGithubLogin(login))
    throw new Error(`"${login}" is not a valid GitHub username.`);

  const token = cleanText(incoming?.token).trim();
  if (token && !/^[A-Za-z0-9_.-]{20,255}$/.test(token))
    throw new Error("That does not look like a GitHub personal access token.");

  const next: StoredExtensionSettings = {
    github: {
      login,
      repositories: incoming
        ? cleanRepositories(incoming.repositories)
        : existing.github.repositories,
      includeReviewRequests: cleanBoolean(
        incoming?.includeReviewRequests,
        existing.github.includeReviewRequests,
      ),
      includeAssignedIssues: cleanBoolean(
        incoming?.includeAssignedIssues,
        existing.github.includeAssignedIssues,
      ),
      includeMentions: cleanBoolean(
        incoming?.includeMentions,
        existing.github.includeMentions,
      ),
      token: incoming?.clearToken ? "" : token || existing.github.token,
    },
  };
  await writeExtensionSettings(next);
  return toPublicExtensionSettings(next);
}
