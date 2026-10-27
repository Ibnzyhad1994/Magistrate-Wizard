/**
 * Removing a deleted record's files from Storage.
 *
 * Deleting a judgment, bench note, quick code, Case Law entry, docket
 * matter or document removes its `documents` rows in SQL, and 0165 queues
 * every one of their files that is still stored. SQL cannot delete a
 * Storage object, so the storage-cleanup Edge Function removes queued
 * files with the service role. The app asks for that run after each
 * delete. The request is best-effort: the queue keeps the paths, so a
 * missed or failed run is picked up by the next one and never fails the
 * delete the person asked for.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type FunctionsClient = Pick<SupabaseClient, "functions">;

export const STORAGE_CLEANUP_FUNCTION = "storage-cleanup";

/** Asks the storage-cleanup Edge Function to remove queued files. Never throws. */
export async function requestStorageCleanup(client: FunctionsClient): Promise<void> {
  try {
    const { error } = await client.functions.invoke(STORAGE_CLEANUP_FUNCTION, {
      method: "POST",
      body: {},
    });
    if (error) {
      console.error("Storage cleanup did not run; the files stay queued for the next run:", error);
    }
  } catch (err) {
    console.error("Storage cleanup did not run; the files stay queued for the next run:", err);
  }
}

/**
 * Runs a delete, then asks for the deleted record's files to be removed.
 * The delete's own error is thrown as before; the cleanup request is not
 * awaited, so it never delays or fails the delete.
 */
export async function deleteThenCleanStorage(
  client: FunctionsClient,
  remove: () => PromiseLike<{ error: unknown }>,
): Promise<void> {
  const { error } = await remove();
  if (error) throw error;
  void requestStorageCleanup(client);
}
