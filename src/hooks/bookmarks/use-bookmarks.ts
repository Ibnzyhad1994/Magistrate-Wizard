import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { Database } from "@/types/database.types";

export type BookmarkEntityType = Database["public"]["Enums"]["bookmark_entity_type"];

export const bookmarksKeys = {
  all: ["bookmarks"] as const,
  for: (entityType: BookmarkEntityType, entityId: string) =>
    ["bookmarks", "for", entityType, entityId] as const,
};

/** Owner-only per RLS — always exactly the caller's own bookmarks. */
export function useBookmarks() {
  return useQuery({
    queryKey: bookmarksKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookmarks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/** Whether the current user has already bookmarked a specific entity — drives the toggle button state. */
export function useIsBookmarked(entityType: BookmarkEntityType, entityId: string | undefined) {
  return useQuery({
    queryKey: bookmarksKeys.for(entityType, entityId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookmarks")
        .select("id")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!entityId,
  });
}

export function useAddBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
    }: {
      entityType: BookmarkEntityType;
      entityId: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase
        .from("bookmarks")
        .insert({ entity_type: entityType, entity_id: entityId, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: (_data, { entityType, entityId }) => {
      toast.success("Bookmarked.");
      void queryClient.invalidateQueries({ queryKey: bookmarksKeys.all });
      void queryClient.invalidateQueries({ queryKey: bookmarksKeys.for(entityType, entityId) });
    },
  });
}

export function useRemoveBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; entityType: BookmarkEntityType; entityId: string }) => {
      const { error } = await supabase.from("bookmarks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { entityType, entityId }) => {
      toast.success("Bookmark removed.");
      void queryClient.invalidateQueries({ queryKey: bookmarksKeys.all });
      void queryClient.invalidateQueries({ queryKey: bookmarksKeys.for(entityType, entityId) });
    },
  });
}
