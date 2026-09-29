import { TRPCError, experimental_trpcMiddleware } from "@trpc/server";
import { z } from "zod";

import {
  zCreateTagRequestSchema,
  zGetTagResponseSchema,
  zTagBasicSchema,
  zTagListResponseSchema,
  zTagListValidatedRequestSchema,
  zUpdateTagRequestSchema,
} from "@karakeep/shared/types/tags";
import { and, eq } from "drizzle-orm";
import {
  bookmarkTags,
  tagAliases,
  tagReviewSuggestions,
} from "@karakeep/db/schema";
import { normalizeTagNameForAlias } from "@karakeep/shared/tagGovernance";

import { addLogFields } from "@karakeep/shared-server";

import type { AuthedContext } from "../index";
import {
  createEventLogMiddleware,
  createScopedAuthedProcedure,
  router,
} from "../index";
import { Tag } from "../models/tags";

const tagsProcedure = createScopedAuthedProcedure("tags");

export const ensureTagOwnership = experimental_trpcMiddleware<{
  ctx: AuthedContext;
  input: { tagId: string };
}>().create(async (opts) => {
  const tag = await Tag.fromId(opts.ctx, opts.input.tagId);
  return opts.next({
    ctx: {
      ...opts.ctx,
      tag,
    },
  });
});

export const tagsAppRouter = router({
  create: tagsProcedure
    .use(createEventLogMiddleware("tag.create"))
    .input(zCreateTagRequestSchema)
    .output(zTagBasicSchema)
    .mutation(async ({ input, ctx }) => {
      const tag = await Tag.create(ctx, input);
      addLogFields<"tag.create">({ "tag.id": tag.tag.id });
      return tag.asBasicTag();
    }),

  get: tagsProcedure
    .input(
      z.object({
        tagId: z.string(),
      }),
    )
    .output(zGetTagResponseSchema)
    .use(ensureTagOwnership)
    .query(async ({ ctx }) => {
      return await ctx.tag.getStats();
    }),
  delete: tagsProcedure
    .input(
      z.object({
        tagId: z.string(),
      }),
    )
    .use(ensureTagOwnership)
    .mutation(async ({ ctx }) => {
      await ctx.tag.delete();
    }),
  deleteUnused: tagsProcedure
    .output(
      z.object({
        deletedTags: z.number(),
      }),
    )
    .mutation(async ({ ctx }) => {
      const deletedCount = await Tag.deleteUnused(ctx);
      return { deletedTags: deletedCount };
    }),
  update: tagsProcedure
    .input(zUpdateTagRequestSchema)
    .output(zTagBasicSchema)
    .use(ensureTagOwnership)
    .mutation(async ({ input, ctx }) => {
      await ctx.tag.update(input);
      return ctx.tag.asBasicTag();
    }),
  merge: tagsProcedure
    .input(
      z.object({
        intoTagId: z.string(),
        fromTagIds: z.array(z.string()),
      }),
    )
    .output(
      z.object({
        mergedIntoTagId: z.string(),
        deletedTags: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await Tag.merge(ctx, input);
    }),
  list: tagsProcedure
    .input(
      // TODO: Remove the optional and default once the next release is out.
      zTagListValidatedRequestSchema
        .optional()
        .default(zTagListValidatedRequestSchema.parse({})),
    )
    .output(zTagListResponseSchema)
    .query(async ({ ctx, input }) => {
      return await Tag.getAll(ctx, {
        nameContains: input.nameContains,
        ids: input.ids,
        attachedBy: input.attachedBy,
        sortBy: input.sortBy,
        pagination: input.limit
          ? {
              page: input.cursor?.page ?? 0,
              limit: input.limit,
            }
          : undefined,
      });
    }),
  listSuggestions: tagsProcedure
    .output(
      z.object({
        suggestions: z.array(
          z.object({
            id: z.string(),
            candidateName: z.string(),
            suggestedTagId: z.string().nullable(),
            suggestedTagName: z.string().nullable(),
            confidence: z.number().nullable(),
            createdAt: z.date(),
          }),
        ),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: tagReviewSuggestions.id,
          candidateName: tagReviewSuggestions.candidateName,
          suggestedTagId: tagReviewSuggestions.suggestedTagId,
          suggestedTagName: bookmarkTags.name,
          confidence: tagReviewSuggestions.confidence,
          createdAt: tagReviewSuggestions.createdAt,
        })
        .from(tagReviewSuggestions)
        .leftJoin(
          bookmarkTags,
          eq(tagReviewSuggestions.suggestedTagId, bookmarkTags.id),
        )
        .where(
          and(
            eq(tagReviewSuggestions.userId, ctx.user.id),
            eq(tagReviewSuggestions.status, "pending"),
          ),
        );

      return { suggestions: rows };
    }),
  resolveSuggestion: tagsProcedure
    .input(
      z.object({
        suggestionId: z.string(),
        action: z.enum(["merge", "dismiss"]),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const [suggestion] = await ctx.db
        .select()
        .from(tagReviewSuggestions)
        .where(
          and(
            eq(tagReviewSuggestions.id, input.suggestionId),
            eq(tagReviewSuggestions.userId, ctx.user.id),
            eq(tagReviewSuggestions.status, "pending"),
          ),
        )
        .limit(1);

      if (!suggestion) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suggestion not found",
        });
      }

      if (input.action === "merge") {
        if (!suggestion.suggestedTagId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This suggestion has no suggested tag",
          });
        }

        const [target] = await ctx.db
          .select({ id: bookmarkTags.id, name: bookmarkTags.name })
          .from(bookmarkTags)
          .where(
            and(
              eq(bookmarkTags.id, suggestion.suggestedTagId),
              eq(bookmarkTags.userId, ctx.user.id),
            ),
          )
          .limit(1);

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Suggested tag no longer exists",
          });
        }

        if (
          normalizeTagNameForAlias(suggestion.candidateName) ===
          normalizeTagNameForAlias(target.name)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Candidate and target tags are identical",
          });
        }

        const [existingCandidate] = await ctx.db
          .select({ id: bookmarkTags.id })
          .from(bookmarkTags)
          .where(
            and(
              eq(bookmarkTags.userId, ctx.user.id),
              eq(
                bookmarkTags.normalizedName,
                normalizeTagNameForAlias(suggestion.candidateName),
              ),
            ),
          )
          .limit(1);

        if (existingCandidate && existingCandidate.id !== target.id) {
          await Tag.merge(ctx, {
            intoTagId: target.id,
            fromTagIds: [existingCandidate.id],
          });
        }

        await ctx.db
          .insert(tagAliases)
          .values({
            userId: ctx.user.id,
            aliasName: suggestion.candidateName,
            aliasNormalizedName: normalizeTagNameForAlias(
              suggestion.candidateName,
            ),
            targetTagId: target.id,
            source: "manual",
          })
          .onConflictDoUpdate({
            target: [tagAliases.userId, tagAliases.aliasNormalizedName],
            set: {
              aliasName: suggestion.candidateName,
              targetTagId: target.id,
              source: "manual" as const,
            },
          });
      }

      await ctx.db
        .update(tagReviewSuggestions)
        .set({
          status: input.action === "merge" ? "accepted" : "dismissed",
          resolvedAt: new Date(),
        })
        .where(eq(tagReviewSuggestions.id, suggestion.id));

      return { success: true };
    }),
});
