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
};

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
            instructions: `Choose the existing canonical tag that represents the same concept as the candidate tag. Choose NONE only if none of the canonical tags covers it. Do not choose a broader tag unless it is the established canonical representation.`,
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
