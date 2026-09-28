import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

import { cn } from "@/lib/utils";

export default function BookmarkLists({
  bookmark,
  className,
}: {
  bookmark: ZBookmark;
  className?: string;
}) {
  const api = useTRPC();
  const { data: allLists } = useBookmarkLists();
  const { data: bookmarkLists, isPending } = useQuery(
    api.lists.getListsOfBookmark.queryOptions({
      bookmarkId: bookmark.id,
    }),
  );

  if (isPending) {
    return (
      <div className={cn("flex flex-wrap gap-1", className)}>
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!bookmarkLists?.lists.length) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {bookmarkLists.lists.map((list) => {
        const path = allLists?.getPathById(list.id);
        const label = path
          ? path.map((l) => `${l.icon} ${l.name}`).join(" / ")
          : `${list.icon} ${list.name}`;

        return (
          <Link
            key={list.id}
            href={`/dashboard/lists/${list.id}`}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
            )}
            title={label}
          >
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
