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
      throw new Error(`jev request failed: ${response.status}`);
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
