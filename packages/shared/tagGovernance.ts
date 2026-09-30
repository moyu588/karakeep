import serverConfig from "./config";

export function normalizeTagNameForAlias(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase()
    .replace(/[ \-_]+/g, "");
}

export interface JevChoiceResponse {
  choice?: string | null;
  confidence?: number;
}

export const TAG_EQUIVALENCE_RULES = `
- Map a candidate tag to an existing canonical tag ONLY when both names represent the same concept.
- Treat these as equivalent: synonyms; full name/abbreviation; Chinese/English translations of the same concept; spelling, case, separator, or plural variants.
- Do NOT map merely related concepts, parent/child concepts, tools to their use cases, platforms to ecosystems, vendors to domains, or specific projects/products to general categories.
- If the candidate name is too ambiguous to identify one concept, choose NONE.
- Approved examples: IP风险, IP查询, IP纯净度, IP地理定位, CleanIP, 代理检测, and ASN map to IP检测 when present; 媒体下载器 maps to 视频下载; 越狱提示词 maps to Prompt_Injection.
- Do not map 安全检测 to 安全工具; they are distinct concepts.
- Do not map specific tools/products such as yt-dlp, firecrawl, Agent_Reach, GitHub, Git, Chrome, or Obsidian to broad categories.
- Do not map website scraping/data extraction or multi-platform agent access to Web搜索; only a generic Web-search concept maps to Web搜索.
`.trim();

/**
 * JEV structured-output limit: a choice question accepts at most 255 criteria.
 * Keep one slot for NONE, so the canonical list is capped at 254.
 */
export const JEV_MAX_CRITERIA = 254;

/**
 * Heuristic relevance scoring for pruning large canonical-tag lists before
 * sending them to JEV. Exact-insensitive match ranks highest, then containment
 * and shared-word overlap, so the most plausible equivalents survive pruning.
 */
export function rankCanonicalTagsForJev(
  candidateTag: string,
  canonicalTags: string[],
  limit = JEV_MAX_CRITERIA,
): string[] {
  if (canonicalTags.length <= limit) {
    return canonicalTags;
  }

  const cand = candidateTag.toLowerCase().trim();
  const candWords = cand.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);

  const scored = canonicalTags.map((tag) => {
    const norm = tag.toLowerCase().trim();
    const words = norm.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);

    let score = 0;
    if (norm === cand) {
      score = 1000;
    } else if (norm.includes(cand) || cand.includes(norm)) {
      score = 500;
    } else {
      const shared = words.filter((w) => candWords.includes(w)).length;
      score = shared > 0 ? Math.min(100, shared * 20) : 0;
    }
    // Prefer shorter canonical tags on ties: they are the broader concept.
    score -= Math.floor(norm.length / 20);
    return { tag, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const kept = scored.slice(0, limit).map((s) => s.tag);
  // Stable, readable order in the JEV payload.
  return kept.sort((a, b) => a.localeCompare(b));
}

export class JevClient {
  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey?: string;
      model: string;
      timeoutSec: number;
    },
  ) {}

  async chooseEquivalentTag(
    candidateTag: string,
    canonicalTags: string[],
  ): Promise<JevChoiceResponse | null> {
    if (canonicalTags.length === 0) {
      return null;
    }

    const criteria = Object.fromEntries(
      canonicalTags.map((tag) => [
        tag,
        "Existing canonical tag that covers the same concept",
      ]),
    );
    criteria.NONE = "No existing canonical tag covers the candidate concept";

    const response = await fetch(this.config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey
          ? { Authorization: `Bearer ${this.config.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        state: `Candidate tag: ${candidateTag}`,
        model: this.config.model,
        questions: {
          tagMapping: {
            type: "choice",
            instructions: `Choose the existing canonical tag that represents the same concept as the candidate tag. Choose NONE only if none of the canonical tags covers it. Do not choose a broader tag unless it is the established canonical representation. Follow these rules:\n${TAG_EQUIVALENCE_RULES}`,
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(this.config.timeoutSec * 1000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `jev request failed: ${response.status} body=${errorBody.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as {
      answers?: Record<string, JevChoiceResponse>;
    };
    return data.answers?.tagMapping ?? null;
  }
}

export function createJevClientFromConfig() {
  const config = serverConfig.tagGovernance.jev;
  return config ? new JevClient(config) : null;
}
