import type { AudiencePlatform } from "@/lib/types";

export type LinkedInProfileKind = "personal" | "organization";

export type LinkedInPublicProfile = {
  followers: number | null;
  kind: LinkedInProfileKind;
  rounded: boolean;
};

export const PUBLIC_PROFILE_CACHE_MS = 60 * 60 * 1000;
export const LINKEDIN_PUBLIC_CACHE_MS = 24 * 60 * 60 * 1000;

export function audienceCacheWindowMs(platform: AudiencePlatform) {
  return platform === "linkedin" ? LINKEDIN_PUBLIC_CACHE_MS : PUBLIC_PROFILE_CACHE_MS;
}

type AudienceAccountIdentity = {
  platform: AudiencePlatform;
  profileUrl: string;
  username: string;
  accountId: string;
};

const platformHosts: Record<AudiencePlatform, string[]> = {
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com"],
  linkedin: ["linkedin.com", "www.linkedin.com"],
  threads: ["threads.com", "www.threads.com", "threads.net", "www.threads.net"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
};

function isPlatformHost(platform: AudiencePlatform, hostname: string) {
  const host = hostname.toLowerCase();
  if (platform === "linkedin" && (host === "linkedin.com" || host.endsWith(".linkedin.com"))) return true;
  return platformHosts[platform].includes(host);
}

const reservedHandles: Partial<Record<AudiencePlatform, Set<string>>> = {
  x: new Set(["compose", "explore", "home", "i", "intent", "messages", "notifications", "search", "settings", "share"]),
  instagram: new Set(["about", "accounts", "developer", "direct", "explore", "legal", "p", "reel", "reels", "stories"]),
  facebook: new Set(["events", "gaming", "groups", "marketplace", "permalink.php", "photo", "photos", "posts", "reel", "share", "story.php", "watch"]),
};

export function parsePublicCount(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const match = value.trim().replaceAll(",", "").match(/^([0-9]*\.?[0-9]+)\s*([KMB])?$/i);
  if (!match) return null;
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000 : match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "B" ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function parsedProfileUrl(value: string) {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

function cleanHandle(value: string) {
  const handle = value.trim().replace(/^@/, "");
  return handle && !/[\s/?#]/.test(handle) ? handle : "";
}

function canonicalPath(parts: string[]) {
  return parts.map((part) => {
    try { return encodeURIComponent(decodeURIComponent(part)); } catch { return encodeURIComponent(part); }
  }).join("/");
}

export function canonicalizePublicProfileUrl(platform: AudiencePlatform, value: string) {
  const url = parsedProfileUrl(value);
  if (!url || !isPlatformHost(platform, url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;

  if (platform === "youtube") {
    const tabs = new Set(["about", "channels", "community", "featured", "playlists", "shorts", "streams", "videos"]);
    if (parts[0].startsWith("@") && cleanHandle(parts[0]) && (parts.length === 1 || parts.length === 2 && tabs.has(parts[1]))) return `https://www.youtube.com/@${canonicalPath([cleanHandle(parts[0])])}`;
    if (["channel", "c", "user"].includes(parts[0]) && cleanHandle(parts[1] || "") && (parts.length === 2 || parts.length === 3 && tabs.has(parts[2]))) return `https://www.youtube.com/${parts[0]}/${canonicalPath([cleanHandle(parts[1])])}`;
    return null;
  }

  if (platform === "x" || platform === "instagram") {
    if (parts.length !== 1) return null;
    const handle = cleanHandle(parts[0]);
    if (!handle || reservedHandles[platform]?.has(handle.toLowerCase())) return null;
    return platform === "x" ? `https://x.com/${canonicalPath([handle])}` : `https://www.instagram.com/${canonicalPath([handle])}/`;
  }

  if (platform === "facebook") {
    const root = parts[0].toLowerCase();
    if (root === "profile.php") {
      const id = cleanHandle(url.searchParams.get("id") || "");
      return id ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}` : null;
    }
    if (["pages", "people"].includes(root) && parts.length === 3 && cleanHandle(parts[1]) && cleanHandle(parts[2])) {
      return `https://www.facebook.com/${root}/${canonicalPath([parts[1], parts[2]])}/`;
    }
    // Facebook redirects profile.php?id=… to this newer page form when signed
    // out, so it has to canonicalize too or the identity check rejects its own
    // redirect target.
    if (root === "p" && parts.length === 2 && cleanHandle(parts[1])) {
      return `https://www.facebook.com/p/${canonicalPath([parts[1]])}/`;
    }
    if (parts.length !== 1) return null;
    const handle = cleanHandle(parts[0]);
    if (!handle || reservedHandles.facebook?.has(handle.toLowerCase())) return null;
    return `https://www.facebook.com/${canonicalPath([handle])}/`;
  }

  if (platform === "linkedin") {
    const root = parts[0].toLowerCase();
    const slug = cleanHandle(parts[1] || "");
    if (!["company", "in", "school", "showcase"].includes(root) || !slug) return null;
    return `https://www.linkedin.com/${root}/${canonicalPath([slug])}/`;
  }

  if (platform === "threads" || platform === "tiktok") {
    if (parts.length !== 1 || !parts[0].startsWith("@")) return null;
    const handle = cleanHandle(parts[0]);
    if (!handle) return null;
    return platform === "threads" ? `https://www.threads.com/@${canonicalPath([handle])}` : `https://www.tiktok.com/@${canonicalPath([handle])}`;
  }

  return null;
}

export function isValidPublicProfileUrl(platform: AudiencePlatform, value: string) {
  return canonicalizePublicProfileUrl(platform, value) !== null;
}

export function resolvePublicProfileUrl(platform: AudiencePlatform, profileUrl: string, username: string) {
  const supplied = canonicalizePublicProfileUrl(platform, profileUrl);
  if (supplied) return supplied;
  const handle = cleanHandle(username);
  if (!handle || reservedHandles[platform]?.has(handle.toLowerCase())) return "";
  const encoded = canonicalPath([handle]);
  const roots: Record<AudiencePlatform, string> = {
    youtube: `https://www.youtube.com/@${encoded}`,
    x: `https://x.com/${encoded}`,
    instagram: `https://www.instagram.com/${encoded}/`,
    facebook: `https://www.facebook.com/${encoded}/`,
    linkedin: `https://www.linkedin.com/in/${encoded}/`,
    threads: `https://www.threads.com/@${encoded}`,
    tiktok: `https://www.tiktok.com/@${encoded}`,
  };
  return roots[platform];
}

export function publicProfileHandle(platform: AudiencePlatform, value: string) {
  const canonical = canonicalizePublicProfileUrl(platform, value);
  if (!canonical) return "";
  const url = new URL(canonical);
  const parts = url.pathname.split("/").filter(Boolean);
  if (platform === "facebook" && parts[0] === "profile.php") return url.searchParams.get("id") || "";
  if (platform === "facebook" && ["pages", "people"].includes(parts[0])) return parts[2] || "";
  if (platform === "youtube" && parts[0].startsWith("@")) return parts[0].slice(1);
  if (platform === "youtube" || platform === "linkedin") return parts[1] || "";
  if (platform === "threads" || platform === "tiktok") return (parts[0] || "").replace(/^@/, "");
  return parts[0] || "";
}

export function audienceAccountFingerprint(account: AudienceAccountIdentity) {
  const resolved = resolvePublicProfileUrl(account.platform, account.profileUrl, account.username);
  return [account.platform, resolved, account.accountId.trim()].join("|");
}

function metaContent(html: string, property: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if ((key?.[1] || key?.[2] || key?.[3] || "").toLowerCase() !== property.toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return content?.[1] || content?.[2] || content?.[3] || "";
  }
  return "";
}

function canonicalLinkHref(html: string) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const relation = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const relations = (relation?.[1] || relation?.[2] || relation?.[3] || "").toLowerCase().split(/\s+/);
    if (!relations.includes("canonical")) continue;
    const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return href?.[1] || href?.[2] || href?.[3] || "";
  }
  return "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&(amp|quot|apos|lt|gt|bull);/gi, (_match, entity: string) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", bull: "•" })[entity.toLowerCase()] || _match);
}

function normalizedEmbeddedText(value: string) {
  return decodeHtmlEntities(value).replaceAll("\\u00a0", " ").replaceAll("\\u2022", " • ");
}

/**
 * The numeric page id behind either Facebook URL spelling:
 * `profile.php?id=123…` and `/p/Name-123…/` denote the same page.
 * Ids are long, so a slug merely ending in a short number is not mistaken
 * for one.
 */
export function facebookNumericId(canonicalUrl: string) {
  const url = new URL(canonicalUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "profile.php") {
    const id = url.searchParams.get("id") || "";
    return /^\d{5,}$/.test(id) ? id : "";
  }
  if (parts[0] === "p" && parts[1]) {
    const trailing = parts[1].split("-").pop() || "";
    return /^\d{10,}$/.test(trailing) ? trailing : "";
  }
  if (["pages", "people"].includes(parts[0]) && parts[2]) {
    return /^\d{5,}$/.test(parts[2]) ? parts[2] : "";
  }
  return "";
}

function profileComparisonKey(platform: AudiencePlatform, value: string) {
  const canonical = canonicalizePublicProfileUrl(platform, value);
  if (!canonical) return "";
  if (platform === "youtube") {
    const parts = new URL(canonical).pathname.split("/").filter(Boolean);
    if (parts[0] === "channel") return `youtube|channel|${parts[1]}`;
  }
  if (platform === "facebook") {
    const id = facebookNumericId(canonical);
    if (id) return `facebook|id|${id}`;
  }
  return canonical.toLowerCase();
}

export function samePublicProfileIdentity(platform: AudiencePlatform, left: string, right: string) {
  const leftKey = profileComparisonKey(platform, left);
  return Boolean(leftKey && leftKey === profileComparisonKey(platform, right));
}

function targetMetadataMatches(platform: AudiencePlatform, html: string, profileUrl: string) {
  const target = canonicalizePublicProfileUrl(platform, profileUrl);
  if (!target) return false;
  const embeddedUrls = [
    normalizedEmbeddedText(metaContent(html, "og:url")),
    normalizedEmbeddedText(canonicalLinkHref(html)),
  ].filter(Boolean);
  if (embeddedUrls.length) {
    return embeddedUrls.every((embeddedUrl) => samePublicProfileIdentity(platform, target, embeddedUrl));
  }

  if (platform === "threads" || platform === "tiktok") {
    const expected = publicProfileHandle(platform, target).toLowerCase();
    const title = normalizedEmbeddedText(metaContent(html, "og:title") || metaContent(html, "twitter:title"));
    const embeddedHandle = title.match(/@([A-Za-z0-9._]+)/)?.[1]?.toLowerCase();
    return Boolean(embeddedHandle && embeddedHandle === expected);
  }
  return false;
}

function jsonObjectTextsForKey(text: string, key: string) {
  const marker = `"${key}"`;
  const values: string[] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const markerIndex = text.indexOf(marker, searchFrom);
    if (markerIndex < 0) return values;
    const colonIndex = text.indexOf(":", markerIndex + marker.length);
    if (colonIndex < 0) return values;
    let start = colonIndex + 1;
    while (/\s/.test(text[start] || "")) start += 1;
    if (text[start] !== "{") {
      searchFrom = markerIndex + marker.length;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        values.push(text.slice(start, index + 1));
        searchFrom = index + 1;
        break;
      }
    }
    if (searchFrom <= markerIndex) return values;
  }
  return values;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonRecord(value: string) {
  if (!value) return {};
  try { return asRecord(JSON.parse(value)); } catch { return {}; }
}

function publicCount(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? parsePublicCount(value) : null;
}

function phraseCount(text: string, label: string) {
  const value = normalizedEmbeddedText(text).match(new RegExp(`([0-9,.]+\\s*[KMB]?)\\s+${label}`, "i"))?.[1];
  return { value: parsePublicCount(value), rounded: Boolean(value && /[KMB]/i.test(value)) };
}

export function parseYouTubePublicProfile(html: string, profileUrl: string) {
  const canonical = canonicalizePublicProfileUrl("youtube", profileUrl);
  if (!canonical) return null;
  const metadata = jsonObjectTextsForKey(html, "channelMetadataRenderer")
    .map(jsonRecord)
    .find((candidate) => typeof candidate.externalId === "string" || typeof candidate.vanityChannelUrl === "string") || {};
  const parts = new URL(canonical).pathname.split("/").filter(Boolean);
  let metadataIdentityProven = false;
  if (parts[0] === "channel" && typeof metadata.externalId === "string") {
    if (metadata.externalId !== parts[1]) return null;
    metadataIdentityProven = true;
  }
  if (parts[0]?.startsWith("@")) {
    const expected = parts[0].slice(1).toLowerCase();
    const urls = [metadata.vanityChannelUrl, ...(Array.isArray(metadata.ownerUrls) ? metadata.ownerUrls : [])]
      .filter((value): value is string => typeof value === "string");
    const handles = urls.map((value) => publicProfileHandle("youtube", value).toLowerCase()).filter(Boolean);
    if (handles.length && !handles.includes(expected)) return null;
    metadataIdentityProven = handles.includes(expected);
  }
  if (!metadataIdentityProven && !targetMetadataMatches("youtube", html, canonical)) return null;

  const header = [...jsonObjectTextsForKey(html, "pageHeaderRenderer"), ...jsonObjectTextsForKey(html, "c4TabbedHeaderRenderer")]
    .find((candidate) => phraseCount(candidate, "subscribers").value !== null) || "";
  if (!header) return { subscribers: null, videos: null, rounded: false };
  const subscribers = phraseCount(header, "subscribers");
  const videos = phraseCount(header, "videos");
  return { subscribers: subscribers.value, videos: videos.value, rounded: subscribers.rounded };
}

function jsonScriptContent(html: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<script\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>([\\s\\S]*?)<\\/script>`, "i"))?.[1]?.trim() || "";
}

export function parseTikTokPublicProfile(html: string, profileUrl: string) {
  const expected = publicProfileHandle("tiktok", profileUrl).toLowerCase();
  if (!expected) return null;

  const universal = jsonRecord(jsonScriptContent(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__"));
  const detail = asRecord(asRecord(universal.__DEFAULT_SCOPE__)["webapp.user-detail"]);
  const universalInfo = asRecord(detail.userInfo);
  const universalUser = asRecord(universalInfo.user);
  const universalStats = asRecord(universalInfo.stats);
  if (Object.keys(universalUser).length) {
    const actual = typeof universalUser.uniqueId === "string" ? universalUser.uniqueId.toLowerCase() : "";
    if (!actual || actual !== expected) return null;
    return { followers: publicCount(universalStats.followerCount), videos: publicCount(universalStats.videoCount), handle: actual, rounded: false };
  }

  const sigi = jsonRecord(jsonScriptContent(html, "SIGI_STATE"));
  const userModule = asRecord(sigi.UserModule);
  const users = asRecord(userModule.users);
  const stats = asRecord(userModule.stats);
  const matchedUser = Object.values(users).map(asRecord).find((user) => typeof user.uniqueId === "string" && user.uniqueId.toLowerCase() === expected);
  if (matchedUser) {
    const id = typeof matchedUser.id === "string" ? matchedUser.id : "";
    const matchedStats = asRecord(stats[id] || stats[expected]);
    return { followers: publicCount(matchedStats.followerCount), videos: publicCount(matchedStats.videoCount), handle: expected, rounded: false };
  }

  if (!targetMetadataMatches("tiktok", html, profileUrl)) return null;
  const description = normalizedEmbeddedText(metaContent(html, "og:description") || metaContent(html, "description"));
  const followers = phraseCount(description, "Followers");
  const videos = phraseCount(description, "Videos");
  return { followers: followers.value, videos: videos.value, handle: expected, rounded: followers.rounded };
}

export function parseFacebookPublicProfile(html: string, profileUrl: string) {
  if (!targetMetadataMatches("facebook", html, profileUrl)) return null;
  const description = normalizedEmbeddedText(metaContent(html, "og:description") || metaContent(html, "description"));
  const followers = phraseCount(description, "followers");
  const likes = phraseCount(description, "likes");
  return { followers: followers.value, likes: likes.value, rounded: followers.rounded || likes.rounded };
}

export function linkedInProfileKind(profileUrl: string): LinkedInProfileKind | null {
  const canonical = canonicalizePublicProfileUrl("linkedin", profileUrl);
  if (!canonical) return null;
  return new URL(canonical).pathname.split("/").filter(Boolean)[0] === "in" ? "personal" : "organization";
}

export function parseLinkedInPublicProfile(html: string, profileUrl: string): LinkedInPublicProfile | null {
  const kind = linkedInProfileKind(profileUrl);
  if (!kind || !targetMetadataMatches("linkedin", html, profileUrl)) return null;
  if (kind === "personal") {
    const value = html.match(/class\s*=\s*["'][^"']*\bnot-first-middot\b[^"']*["'][^>]*>[\s\S]{0,1200}?<span[^>]*>\s*([0-9,.]+\s*[KMB]?)\s+followers\s*<\/span>/i)?.[1];
    return { followers: parsePublicCount(value), kind, rounded: Boolean(value && /[KMB]/i.test(value)) };
  }
  const value = metaContent(html, "og:description").match(/([0-9,.]+\s*[KMB]?)\s+followers on LinkedIn/i)?.[1];
  return { followers: parsePublicCount(value), kind, rounded: Boolean(value && /[KMB]/i.test(value)) };
}

function splitSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/g);
}

export function cookieHeaderFromSetCookie(values: string | string[]) {
  const cookies = new Map<string, string>();
  for (const header of Array.isArray(values) ? values : [values]) {
    for (const item of splitSetCookieHeader(header)) {
      const pair = item.split(";", 1)[0]?.trim();
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator <= 0) continue;
      cookies.set(pair.slice(0, separator), pair);
    }
  }
  return [...cookies.values()].join("; ");
}

export function mergeCookieHeaders(current: string, incoming: string) {
  const cookies = new Map<string, string>();
  for (const pair of [current, incoming].filter(Boolean).flatMap((header) => header.split(/;\s*/))) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(pair.slice(0, separator), pair);
  }
  return [...cookies.values()].join("; ");
}

export function sameHostRedirectSession(currentUrl: string, location: string, currentCookies: string, responseSetCookies: string | string[]) {
  const current = new URL(currentUrl);
  const next = new URL(location, current);
  if (next.hostname.toLowerCase() !== current.hostname.toLowerCase()) return null;
  const incoming = cookieHeaderFromSetCookie(responseSetCookies);
  return { nextUrl: next.toString(), cookieHeader: mergeCookieHeaders(currentCookies, incoming) };
}

export function linkedInHttpError(status: number) {
  if ([403, 429, 999].includes(status)) return { code: "provider_blocked" as const, message: "LinkedIn temporarily blocked this public profile check. Any previously verified count is preserved; try again later." };
  if (status === 404) return { code: "not_found" as const, message: "LinkedIn could not find a public profile at this URL." };
  return { code: "provider_unavailable" as const, message: "LinkedIn could not complete this public profile check right now." };
}

export function parseThreadsPublicProfile(html: string, profileUrl = "") {
  if (profileUrl && !targetMetadataMatches("threads", html, profileUrl)) return { followers: null, threads: null };
  const description = normalizedEmbeddedText(metaContent(html, "og:description") || metaContent(html, "description"));
  const followers = description.match(/([0-9,.]+\s*[KMB]?)\s+Followers/i)?.[1];
  const threads = description.match(/([0-9,.]+)\s+Threads/i)?.[1];
  return {
    followers: parsePublicCount(followers),
    threads: parsePublicCount(threads),
  };
}
