import { and, eq, inArray } from "drizzle-orm";
import type { InferenceClient } from "@karakeep/shared/inference";
import serverConfig from "@karakeep/shared/config";
import {
  createJevClientFromConfig,
  normalizeTagNameForAlias,
  rankCanonicalTagsForJev,
} from "@karakeep/shared/tagGovernance";
import type { db as DB } from "@karakeep/db";
import {
  bookmarkTags,
  tagAliases,
  tagReviewSuggestions,
} from "@karakeep/db/schema";

type ResolverDb = typeof DB;

interface ResolveOptions {
  db: ResolverDb;
  userId: string;
  tags: string[];
  /** Only enable for AI output. Human/import input uses exact aliases only. */
  semanticResolution?: boolean;
  inferenceClient?: InferenceClient;
};

export interface ResolvedTag {
  original: string;
  resolved: string;
};

async function genericInferEquivalentTag(
  candidateTag: string,
  canonicalTags: string[],
  inferenceClient: InferenceClient,
): Promise<{ tag: string | null; confidence: number } | null> {
  if (canonicalTags.length === 0) {
    return null;
  }

  const prompt = `Choose the existing canonical tag that represents the same concept as the candidate tag.
Candidate tag: ${candidateTag}
Canonical tags: ${canonicalTags.join(", ")}
If none covers the same concept, return null for tag.
Respond ONLY with compact JSON in this format: {"tag": string | null, "confidence": number}
Do not wrap the response in markdown.`;
  const response = await inferenceClient.inferFromText(prompt, {
    schema: null,
  });
  try {
    const parsed = JSON.parse(response.response) as {
      tag?: string | null;
      confidence?: number;
    };
    return {
      tag: parsed.tag ?? null,
      confidence: parsed.confidence ?? 0,
    };
  } catch {
    return null;
  }
}

async function inferEquivalentTag(
  candidateTag: string,
  canonicalTags: string[],
  inferenceClient?: InferenceClient,
): Promise<{ tag: string | null; confidence: number } | null> {
  const jev = createJevClientFromConfig();
  if (jev) {
    const pruned = rankCanonicalTagsForJev(candidateTag, canonicalTags);
    const result = await jev.chooseEquivalentTag(candidateTag, pruned);
    if (result?.choice && result.choice !== "NONE") {
      return {
        tag: result.choice,
        confidence: result.confidence ?? 0,
      };
    }
    if (result?.choice === "NONE") {
      return null;
    }
  }

  if (inferenceClient) {
    return await genericInferEquivalentTag(
      candidateTag,
      canonicalTags,
      inferenceClient,
    );
  }

  return null;
}

export async function resolveTagNames({
  db,
  userId,
  tags,
  semanticResolution = false,
  inferenceClient,
}: ResolveOptions): Promise<ResolvedTag[]> {
  const uniqueTags = [
    ...new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
  ];
  if (uniqueTags.length === 0) {
    return [];
  }

  const normalizedTags = uniqueTags.map((tag) => ({
    original: tag,
    normalized: normalizeTagNameForAlias(tag),
  }));

  const [aliases, allTags] = await Promise.all([
    db
      .select({
        aliasName: tagAliases.aliasName,
        aliasNormalizedName: tagAliases.aliasNormalizedName,
        targetTagId: tagAliases.targetTagId,
      })
      .from(tagAliases)
      .where(
        and(
          eq(tagAliases.userId, userId),
          inArray(
            tagAliases.aliasNormalizedName,
            normalizedTags.map((t) => t.normalized),
          ),
        ),
      ),
    db
      .select({ id: bookmarkTags.id, name: bookmarkTags.name })
      .from(bookmarkTags)
      .where(eq(bookmarkTags.userId, userId)),
  ]);

  const aliasByNormalized = new Map(
    aliases.map((alias) => [alias.aliasNormalizedName, alias]),
  );
  const targetTagIds = [...new Set(aliases.map((a) => a.targetTagId))];
  const targetTags = targetTagIds.length
    ? await db
        .select({ id: bookmarkTags.id, name: bookmarkTags.name })
        .from(bookmarkTags)
        .where(inArray(bookmarkTags.id, targetTagIds))
    : [];
  const targetById = new Map(targetTags.map((t) => [t.id, t.name]));
  const tagByNormalized = new Map(
    allTags.map((tag) => [normalizeTagNameForAlias(tag.name), tag]),
  );

  const resolved: ResolvedTag[] = [];
  const unresolvedCandidates: string[] = [];

  for (const tag of normalizedTags) {
    const alias = aliasByNormalized.get(tag.normalized);
    const aliasTargetName = alias
      ? targetById.get(alias.targetTagId)
      : undefined;
    const exactTag = tagByNormalized.get(tag.normalized);

    if (aliasTargetName) {
      resolved.push({ original: tag.original, resolved: aliasTargetName });
    } else if (exactTag) {
      resolved.push({ original: tag.original, resolved: exactTag.name });
    } else {
      resolved.push({ original: tag.original, resolved: tag.original });
      unresolvedCandidates.push(tag.original);
    }
  }

  if (
    !semanticResolution ||
    !serverConfig.tagGovernance.enabled ||
    unresolvedCandidates.length === 0
  ) {
    return resolved;
  }

  for (const candidate of unresolvedCandidates) {
    const candidateNormalized = normalizeTagNameForAlias(candidate);
    const otherTags = allTags.filter(
      (tag) => normalizeTagNameForAlias(tag.name) !== candidateNormalized,
    );
    if (otherTags.length === 0) {
      continue;
    }

    const equivalent = await inferEquivalentTag(
      candidate,
      otherTags.map((tag) => tag.name),
      inferenceClient,
    );
    if (!equivalent?.tag) {
      continue;
    }

    const target = tagByNormalized.get(normalizeTagNameForAlias(equivalent.tag));
    if (!target) {
      continue;
    }

    if (equivalent.confidence >= serverConfig.tagGovernance.autoMergeThreshold) {
      await db
        .insert(tagAliases)
        .values({
          userId,
          aliasName: candidate,
          aliasNormalizedName: candidateNormalized,
          targetTagId: target.id,
          source: "ai",
        })
        .onConflictDoUpdate({
          target: [tagAliases.userId, tagAliases.aliasNormalizedName],
          set: {
            aliasName: candidate,
            targetTagId: target.id,
            source: "ai",
          },
        });
      const index = resolved.findIndex((tag) => tag.original === candidate);
      if (index !== -1) {
        resolved[index] = { original: candidate, resolved: target.name };
      }
    } else if (
      equivalent.confidence >= serverConfig.tagGovernance.reviewThreshold
    ) {
      await db
        .insert(tagReviewSuggestions)
        .values({
          userId,
          candidateName: candidate,
          candidateNormalizedName: candidateNormalized,
          suggestedTagId: target.id,
          confidence: equivalent.confidence,
        })
        .onConflictDoUpdate({
          target: [
            tagReviewSuggestions.userId,
            tagReviewSuggestions.candidateNormalizedName,
          ],
          set: {
            candidateName: candidate,
            suggestedTagId: target.id,
            confidence: equivalent.confidence,
            status: "pending",
            resolvedAt: null,
          },
        });
    }
  }

  return resolved;
}
