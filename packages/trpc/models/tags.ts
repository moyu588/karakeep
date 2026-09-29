import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  like,
  notExists,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import type { ZAttachedByEnum } from "@karakeep/shared/types/tags";
import { SqliteError } from "@karakeep/db";
import { bookmarkTags, tagsOnBookmarks } from "@karakeep/db/schema";
import { triggerSearchReindex } from "@karakeep/shared-server";
import {
  zCreateTagRequestSchema,
  zGetTagResponseSchema,
  zTagBasicSchema,
  zUpdateTagRequestSchema,
} from "@karakeep/shared/types/tags";
import { switchCase } from "@karakeep/shared/utils/switch";
import { normalizeTagNameForAlias } from "@karakeep/shared/tagGovernance";
import { tagAliases } from "@karakeep/db/schema";
import { resolveTagNames } from "../lib/tagResolver";

import { AuthedContext } from "..";

export class Tag {
  constructor(
    protected ctx: AuthedContext,
    public tag: typeof bookmarkTags.$inferSelect,
  ) {}

  static async fromId(ctx: AuthedContext, id: string): Promise<Tag> {
    const tag = await ctx.db.query.bookmarkTags.findFirst({
      where: eq(bookmarkTags.id, id),
    });

    if (!tag) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Tag not found",
      });
    }

    // If it exists but belongs to another user, throw forbidden error
    if (tag.userId !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User is not allowed to access resource",
      });
    }

    return new Tag(ctx, tag);
  }

  static async create(
    ctx: AuthedContext,
    input: z.infer<typeof zCreateTagRequestSchema>,
  ): Promise<Tag> {
    const [resolvedName] = await resolveTagNames({
      db: ctx.db,
      userId: ctx.user.id,
      tags: [input.name],
    });

    // Resolver may map an alias or alternate spelling to an existing tag.
    // In that case, creation should resolve to the canonical tag instead of
    // hitting the unique constraint.
    const [existingTag] = await ctx.db
      .select()
      .from(bookmarkTags)
      .where(
        and(
          eq(bookmarkTags.userId, ctx.user.id),
          eq(bookmarkTags.name, resolvedName.resolved),
        ),
      )
      .limit(1);

    if (existingTag) {
      return new Tag(ctx, existingTag);
    }

    try {
      const [result] = await ctx.db
        .insert(bookmarkTags)
        .values({
          name: resolvedName.resolved,
          userId: ctx.user.id,
        })
        .returning();

      return new Tag(ctx, result);
    } catch (e) {
      if (e instanceof SqliteError && e.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tag name already exists for this user.",
        });
      }
      throw e;
    }
  }

  static async getAll(
    ctx: AuthedContext,
    opts: {
      nameContains?: string;
      ids?: string[];
      attachedBy?: "ai" | "human" | "none";
      sortBy?: "name" | "usage" | "relevance";
      pagination?: {
        page: number;
        limit: number;
      };
    } = {},
  ) {
    const sortBy = opts.sortBy ?? "usage";

    const countAi = sql<number>`
      SUM(CASE WHEN ${tagsOnBookmarks.attachedBy} = 'ai' THEN 1 ELSE 0 END)
    `;
    const countHuman = sql<number>`
      SUM(CASE WHEN ${tagsOnBookmarks.attachedBy} = 'human' THEN 1 ELSE 0 END)
    `;
    // Count only matched right rows; will be 0 when there are none
    const countAny = sql<number>`COUNT(${tagsOnBookmarks.tagId})`;
    let qSql = ctx.db
      .select({
        id: bookmarkTags.id,
        name: bookmarkTags.name,
        countAttachedByAi: countAi.as("countAttachedByAi"),
        countAttachedByHuman: countHuman.as("countAttachedByHuman"),
        count: countAny.as("count"),
      })
      .from(bookmarkTags)
      .leftJoin(tagsOnBookmarks, eq(bookmarkTags.id, tagsOnBookmarks.tagId))
      .where(
        and(
          eq(bookmarkTags.userId, ctx.user.id),
          opts.nameContains
            ? like(bookmarkTags.name, `%${opts.nameContains}%`)
            : undefined,
          opts.ids && opts.ids.length > 0
            ? inArray(bookmarkTags.id, opts.ids)
            : undefined,
        ),
      )
      .groupBy(bookmarkTags.id, bookmarkTags.name)
      .orderBy(
        ...switchCase(sortBy, {
          name: [asc(bookmarkTags.name)],
          usage: [desc(sql`count`)],
          relevance: [
            desc(sql<number>`
            CASE
              WHEN lower(${opts.nameContains ?? ""}) = lower(${bookmarkTags.name}) THEN 2
              WHEN ${bookmarkTags.name} LIKE ${opts.nameContains ? opts.nameContains + "%" : ""} THEN 1
              ELSE 0
            END`),
            asc(sql<number>`length(${bookmarkTags.name})`),
          ],
        }),
      )
      .having(
        opts.attachedBy
          ? switchCase(opts.attachedBy, {
              ai: and(eq(countHuman, 0), gt(countAi, 0)),
              human: gt(countHuman, 0),
              none: eq(countAny, 0),
            })
          : undefined,
      );

    if (opts.pagination) {
      qSql.offset(opts.pagination.page * opts.pagination.limit);
      qSql.limit(opts.pagination.limit + 1);
    }
    const tags = await qSql;

    let nextCursor = null;
    if (opts.pagination) {
      if (tags.length > opts.pagination.limit) {
        tags.pop();
        nextCursor = {
          page: opts.pagination.page + 1,
        };
      }
    }

    return {
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        numBookmarks: t.count,
        numBookmarksByAttachedType: {
          ai: t.countAttachedByAi,
          human: t.countAttachedByHuman,
        },
      })),
      nextCursor,
    };
  }

  static async deleteUnused(ctx: AuthedContext): Promise<number> {
    const res = await ctx.db
      .delete(bookmarkTags)
      .where(
        and(
          eq(bookmarkTags.userId, ctx.user.id),
          notExists(
            ctx.db
              .select({ id: tagsOnBookmarks.tagId })
              .from(tagsOnBookmarks)
              .where(eq(tagsOnBookmarks.tagId, bookmarkTags.id)),
          ),
        ),
      );
    return res.changes;
  }

  static async merge(
    ctx: AuthedContext,
    input: {
      intoTagId: string;
      fromTagIds: string[];
    },
  ): Promise<{
    mergedIntoTagId: string;
    deletedTags: string[];
  }> {
    const requestedTags = new Set([input.intoTagId, ...input.fromTagIds]);
    if (requestedTags.size === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No tags provided",
      });
    }
    if (input.fromTagIds.includes(input.intoTagId)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot merge tag into itself",
      });
    }

    const affectedTags = await ctx.db.query.bookmarkTags.findMany({
      where: and(
        eq(bookmarkTags.userId, ctx.user.id),
        inArray(bookmarkTags.id, [...requestedTags]),
      ),
      columns: {
        id: true,
        userId: true,
      },
    });

    if (affectedTags.some((t) => t.userId !== ctx.user.id)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User is not allowed to access resource",
      });
    }
    if (affectedTags.length !== requestedTags.size) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "One or more tags not found",
      });
    }

    const { deletedTags, deletedTagNames, affectedBookmarks } =
      await ctx.db.transaction((trx) => {
        const unlinked = trx
          .delete(tagsOnBookmarks)
          .where(and(inArray(tagsOnBookmarks.tagId, input.fromTagIds)))
          .returning()
          .all();

        if (unlinked.length > 0) {
          trx
            .insert(tagsOnBookmarks)
            .values(
              unlinked.map((u) => ({
                ...u,
                tagId: input.intoTagId,
              })),
            )
            .onConflictDoNothing()
            .run();
        }

        // Keep historical aliases valid when a former canonical tag is removed.
        trx
          .update(tagAliases)
          .set({ targetTagId: input.intoTagId })
          .where(inArray(tagAliases.targetTagId, input.fromTagIds))
          .run();

        const deletedTags = trx
          .delete(bookmarkTags)
          .where(
            and(
              inArray(bookmarkTags.id, input.fromTagIds),
              eq(bookmarkTags.userId, ctx.user.id),
            ),
          )
          .returning({ id: bookmarkTags.id, name: bookmarkTags.name })
          .all();

        return {
          deletedTags,
          deletedTagNames: deletedTags.map((t) => t.name),
          affectedBookmarks: unlinked.map((u) => u.bookmarkId),
        };
      });

    const targetTag = affectedTags.find((t) => t.id === input.intoTagId);
    if (targetTag && deletedTagNames.length > 0) {
      const [target] = await ctx.db
        .select({ id: bookmarkTags.id, name: bookmarkTags.name })
        .from(bookmarkTags)
        .where(eq(bookmarkTags.id, input.intoTagId))
        .limit(1);
      if (target) {
        await ctx.db
          .insert(tagAliases)
          .values(
            deletedTagNames.map((aliasName) => ({
              userId: ctx.user.id,
              aliasName,
              aliasNormalizedName: normalizeTagNameForAlias(aliasName),
              targetTagId: target.id,
              source: "merge" as const,
            })),
          )
          .onConflictDoUpdate({
            target: [tagAliases.userId, tagAliases.aliasNormalizedName],
            set: {
              targetTagId: target.id,
              source: "merge" as const,
            },
          });
      }
    }

    try {
      await Promise.all(
        affectedBookmarks.map((id) =>
          triggerSearchReindex(id, {
            groupId: ctx.user.id,
          }),
        ),
      );
    } catch (e) {
      console.error("Failed to reindex affected bookmarks", e);
    }

    return {
      deletedTags: deletedTags.map((t) => t.id),
      mergedIntoTagId: input.intoTagId,
    };
  }

  async delete(): Promise<void> {
    const affectedBookmarks = await this.ctx.db
      .select({
        bookmarkId: tagsOnBookmarks.bookmarkId,
      })
      .from(tagsOnBookmarks)
      .where(eq(tagsOnBookmarks.tagId, this.tag.id));

    const res = await this.ctx.db
      .delete(bookmarkTags)
      .where(
        and(
          eq(bookmarkTags.id, this.tag.id),
          eq(bookmarkTags.userId, this.ctx.user.id),
        ),
      );

    if (res.changes === 0) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    await Promise.all(
      affectedBookmarks.map(({ bookmarkId }) =>
        triggerSearchReindex(bookmarkId, {
          groupId: this.ctx.user.id,
        }),
      ),
    );
  }

  async update(input: z.infer<typeof zUpdateTagRequestSchema>): Promise<void> {
    const oldName = this.tag.name;
    try {
      const result = await this.ctx.db
        .update(bookmarkTags)
        .set({
          name: input.name,
        })
        .where(
          and(
            eq(bookmarkTags.id, this.tag.id),
            eq(bookmarkTags.userId, this.ctx.user.id),
          ),
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      this.tag = result[0];

      if (
        input.name &&
        normalizeTagNameForAlias(oldName) !==
          normalizeTagNameForAlias(input.name)
      ) {
        await this.ctx.db
          .insert(tagAliases)
          .values({
            userId: this.ctx.user.id,
            aliasName: oldName,
            aliasNormalizedName: normalizeTagNameForAlias(oldName),
            targetTagId: this.tag.id,
            source: "manual",
          })
          .onConflictDoUpdate({
            target: [tagAliases.userId, tagAliases.aliasNormalizedName],
            set: {
              targetTagId: this.tag.id,
              source: "manual" as const,
            },
          });
      }

      try {
        const affectedBookmarks =
          await this.ctx.db.query.tagsOnBookmarks.findMany({
            where: eq(tagsOnBookmarks.tagId, this.tag.id),
            columns: {
              bookmarkId: true,
            },
          });
        await Promise.all(
          affectedBookmarks
            .map((b) => b.bookmarkId)
            .map((id) =>
              triggerSearchReindex(id, { groupId: this.ctx.user.id }),
            ),
        );
      } catch (e) {
        console.error("Failed to reindex affected bookmarks", e);
      }
    } catch (e) {
      if (e instanceof SqliteError) {
        if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Tag name already exists. You might want to consider a merge instead.",
          });
        }
      }
      throw e;
    }
  }

  static _aggregateStats(
    res: { attachedBy: "ai" | "human" | null; count: number }[],
  ) {
    const numBookmarksByAttachedType = res.reduce<
      Record<ZAttachedByEnum, number>
    >(
      (acc, curr) => {
        if (curr.attachedBy) {
          acc[curr.attachedBy] += curr.count;
        }
        return acc;
      },
      { ai: 0, human: 0 },
    );
    return {
      numBookmarks:
        numBookmarksByAttachedType.ai + numBookmarksByAttachedType.human,
      numBookmarksByAttachedType,
    };
  }

  async getStats(): Promise<z.infer<typeof zGetTagResponseSchema>> {
    const res = await this.ctx.db
      .select({
        id: bookmarkTags.id,
        name: bookmarkTags.name,
        attachedBy: tagsOnBookmarks.attachedBy,
        count: count(),
      })
      .from(bookmarkTags)
      .leftJoin(tagsOnBookmarks, eq(bookmarkTags.id, tagsOnBookmarks.tagId))
      .where(
        and(
          eq(bookmarkTags.id, this.tag.id),
          eq(bookmarkTags.userId, this.ctx.user.id),
        ),
      )
      .groupBy(tagsOnBookmarks.attachedBy);

    if (res.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    return {
      id: res[0].id,
      name: res[0].name,
      ...Tag._aggregateStats(res),
    };
  }

  asBasicTag(): z.infer<typeof zTagBasicSchema> {
    return {
      id: this.tag.id,
      name: this.tag.name,
    };
  }
}
