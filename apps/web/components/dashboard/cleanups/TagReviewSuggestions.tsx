"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import LoadingSpinner from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@karakeep/shared-react/trpc";

export function TagReviewSuggestions() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery(
    api.tags.listSuggestions.queryOptions(),
  );

  const invalidate = () => {
    void refetch();
    void queryClient.invalidateQueries(api.tags.list.pathFilter());
  };

  const resolveSuggestion = useMutation(
    api.tags.resolveSuggestion.mutationOptions({
      onSuccess: async (_result, variables) => {
        toast({
          description:
            variables.action === "merge"
              ? "已合并并创建别名。"
              : "已忽略该建议。",
        });
        invalidate();
      },
      onError: (error) => {
        toast({
          description: error.message,
          variant: "destructive",
        });
      },
    }),
  );

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const suggestions = data?.suggestions ?? [];

  return (
    <div className="flex flex-col gap-y-3">
      <p className="text-sm italic text-muted-foreground">
        待确认 Tag 建议共 {suggestions.length} 个。合并后会创建别名，后续相同
        tag 会自动归并到目标 tag。
      </p>
      {suggestions.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>候选 Tag</TableHead>
              <TableHead>建议目标</TableHead>
              <TableHead className="w-24 text-right">置信度</TableHead>
              <TableHead className="w-40 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suggestions.map((suggestion) => (
              <TableRow key={suggestion.id}>
                <TableCell>{suggestion.candidateName}</TableCell>
                <TableCell>
                  {suggestion.suggestedTagName ? (
                    <Badge variant="outline">
                      {suggestion.suggestedTagName}
                    </Badge>
                  ) : (
                    "已不存在"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {suggestion.confidence?.toFixed(2) ?? "-"}
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <ActionButton
                    size="sm"
                    variant="default"
                    loading={resolveSuggestion.isPending}
                    disabled={!suggestion.suggestedTagName}
                    onClick={() =>
                      resolveSuggestion.mutate({
                        suggestionId: suggestion.id,
                        action: "merge",
                      })
                    }
                  >
                    <Check className="mr-1 size-4" />
                    合并
                  </ActionButton>
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    loading={resolveSuggestion.isPending}
                    onClick={() =>
                      resolveSuggestion.mutate({
                        suggestionId: suggestion.id,
                        action: "dismiss",
                      })
                    }
                  >
                    <X className="mr-1 size-4" />
                    忽略
                  </ActionButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
