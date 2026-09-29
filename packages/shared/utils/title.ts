export const CHALLENGE_TITLE_PATTERNS = [
  /^just a moment[.\u2026!]*$/i,
  /^attention required[!?.]*\s*\|?\s*cloudflare$/i,
  /^access denied$/i,
  /^robot check$/i,
  /^bot verification$/i,
  /^captcha required$/i,
  /^service unavailable$/i,
  /^page not found$/i,
];

/**
 * Returns true when a crawled title is unlikely to be useful as a human-facing
 * bookmark title. This intentionally avoids rewriting normal article titles.
 */
export function isLowQualityTitle(title: string | null | undefined, url?: string | null): boolean {
  const normalizedTitle = title?.trim() ?? "";
  if (!normalizedTitle) {
    return true;
  }

  if (normalizedTitle.length < 4) {
    return true;
  }

  if (CHALLENGE_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return true;
  }

  if (/^github\s*-\s*/i.test(normalizedTitle)) {
    return true;
  }

  if (/^https?:\/\//i.test(normalizedTitle)) {
    return true;
  }

  // A UUID/hash-like title is rarely useful.
  if (/^[a-f0-9]{8,}([-\s]?[a-f0-9]{4,})*$/i.test(normalizedTitle)) {
    return true;
  }

  if (url) {
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname.replace(/^www\./i, "");
      const normalizedHost = host.toLocaleLowerCase();
      const normalizedTitleForHost = normalizedTitle.toLocaleLowerCase();
      if (
        normalizedTitleForHost === normalizedHost ||
        normalizedTitleForHost === `${normalizedHost}/`
      ) {
        return true;
      }
    } catch {
      // Ignore invalid URLs; title checks above are still valid.
    }
  }

  // Slugs such as "some-long-project-name" or "some_project_name".
  const hasSpace = /\s/.test(normalizedTitle);
  const separatorCount = (normalizedTitle.match(/[-_]/g) ?? []).length;
  if (!hasSpace && separatorCount >= 2) {
    return true;
  }

  return false;
}

export function stripSourceTitlePrefixes(title: string): string {
  return title
    .replace(/^github\s*-\s*/i, "")
    .replace(/^(?:blog|docs|documentation|news)\s*[:|\-–]\s*/i, "")
    .trim();
}

export function truncateTitle(title: string, maxLength = 120): string {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (normalizedTitle.length <= maxLength) {
    return normalizedTitle;
  }
  return `${normalizedTitle.slice(0, maxLength - 1).trimEnd()}…`;
}
