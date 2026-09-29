import { eq } from "drizzle-orm";

import type { InferenceClient } from "@karakeep/shared/inference";
import type { DequeuedJob } from "@karakeep/shared/queueing";
import type { ZOpenAIRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import { bookmarkLinks } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { triggerSearchReindex } from "@karakeep/shared-server";
import { isLowQualityTitle, stripSourceTitlePrefixes, truncateTitle } from "@karakeep/shared/utils/title";

const MAX_TITLE_LENGTH = 120;

interface BookmarkWithTitle {
  id: string;
  userId: string;
  link: {
    url: string;
    title: string | null;
    description: string | null;
  } | null;
  // bookmark.title is the user-facing override; if present, never rewrite it.
  title: string | null;
};

function parseTitleResponse(response: string): string | null {
  try {
    const parsed = JSON.parse(response) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : null;
  } catch {
    // Some smaller models may ignore JSON instructions despite the prompt.
    const match = response.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function optimizeBookmarkTitle(
  bookmark: BookmarkWithTitle,
  inferenceClient: InferenceClient,
  job: DequeuedJob<ZOpenAIRequest>,
): Promise<void> {
  if (
    !serverConfig.titleOptimization.enabled ||
    !bookmark.link ||
    bookmark.title
  ) {
    return;
  }

  const currentTitle = bookmark.link.title;
  if (!isLowQualityTitle(currentTitle, bookmark.link.url)) {
    return;
  }

  logger.info(
    `[inference][${job.id}] Optimizing low-quality title for bookmark "${bookmark.id}"`,
  );

  const prompt = `Generate a concise, accurate, human-friendly bookmark title.
Respond ONLY with compact JSON in this format: {"title": string}
Rules:
- Write in Simplified Chinese.
- Keep necessary product, project, organization, library, protocol and proper nouns in their original form.
- Do not invent facts that are absent from the input.
- Do not include prefixes such as "GitHub -", site names, domains, pipe separators, or marketing filler.
- Prefer 8-40 Chinese characters (or an equivalent short length).
- If the original title is already a clear human title, return that exact title.

URL: ${bookmark.link.url}
Original title: ${currentTitle ?? ""}
Description: ${bookmark.link.description ?? ""}`;

  const response = await inferenceClient.inferFromText(prompt, {
    schema: null,
    abortSignal: job.abortSignal,
  });

  const generatedTitle = parseTitleResponse(response.response);
  if (!generatedTitle?.trim()) {
    logger.warn(
      `[inference][${job.id}] Title optimization returned no usable title for bookmark "${bookmark.id}"`,
    );
    return;
  }

  const cleanTitle = truncateTitle(
    stripSourceTitlePrefixes(generatedTitle),
    MAX_TITLE_LENGTH,
  );
  if (!cleanTitle || isLowQualityTitle(cleanTitle, bookmark.link.url)) {
    logger.info(
      `[inference][${job.id}] Skipping optimized title for bookmark "${bookmark.id}" because it is still low quality`,
    );
    return;
  }

  await db
    .update(bookmarkLinks)
    .set({ title: cleanTitle })
    .where(eq(bookmarkLinks.id, bookmark.id));

  logger.info(
    `[inference][${job.id}] Optimized title for bookmark "${bookmark.id}"`,
  );

  try {
    await triggerSearchReindex(bookmark.id, {
      priority: job.priority,
      groupId: bookmark.userId,
    });
  } catch (error) {
    logger.error(
      `[inference][${job.id}] Failed to reindex bookmark "${bookmark.id}" after title optimization: ${error}`,
    );
  }
}
