# BenchBook — Supabase backend

11 migrations, applied in filename order, build the entire backend:

| # | File | Adds |
|---|------|------|
| 0001 | `0001_init.sql` | `user_role` enum, `profiles`, `handle_new_user()` signup trigger, `is_admin()`, `set_updated_at()` |
| 0002 | `0002_courts.sql` | `courts`, `profiles.court_id`, `my_court_id()` |
| 0003 | `0003_cases.sql` | `case_status`/`party_role` enums, `cases`, `case_parties`, `user_can_access_case()` |
| 0004 | `0004_bench_notes.sql` | `note_status` enum, `bench_notes` (+FTS), `user_can_access_bench_note()` |
| 0005 | `0005_legal_library.sql` | `statutes`, `case_law` (+FTS) — shared, admin-curated reference data |
| 0006 | `0006_tags.sql` | `tags` + per-entity join tables |
| 0007 | `0007_documents.sql` | `documents` metadata table |
| 0008 | `0008_comments_bookmarks.sql` | `comments`, `bookmarks` (+entity-validation trigger) |
| 0009 | `0009_audit_log.sql` | `audit_log` + generic audit trigger on the sensitive tables |
| 0010 | `0010_search.sql` | `search_statutes`, `search_case_law`, `search_bench_notes`, `search_cases`, `global_search` RPCs |
| 0011 | `0011_storage.sql` | `documents` + `avatars` Storage buckets and their policies |

Every table has RLS enabled from the migration that creates it — there is
no window where a table exists without policies.

## Option A — Supabase CLI (recommended)

```bash
npm install -g supabase        # if you don't have it
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                # applies every migration in supabase/migrations, in order
```

`<your-project-ref>` is the id in your project's URL
(`https://<project-ref>.supabase.co`) — also under Project Settings → General.

## Option B — Dashboard SQL editor

If you'd rather not install the CLI: open **SQL Editor** in your Supabase
project, and run each file **in numeric order**, one at a time,
`0001_init.sql` → `0011_storage.sql`. Each file is idempotent-safe to
re-run only up to the point of first failure — if one errors partway
through, fix and re-run just that statement rather than the whole file,
since `create table`/`create type` will error on a second run (`create
policy`/function bodies use `or replace` or are safe to skip if already
applied).

## After the migrations run

1. **Promote your own account to admin.** Every new signup defaults to
   `role = 'magistrate'`. Sign up once through the app, then in the SQL
   editor:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

   Admins are the only role that can write to `courts`, `statutes`, and
   `case_law` — you'll need at least one before the reference library is
   usable.

2. **Create at least one court.** Cases and profiles are scoped to a
   court for row-level security, so nothing else will be visible until
   one exists:

   ```sql
   insert into public.courts (name, jurisdiction) values ('County Magistrate Court', 'Sample County');
   ```

   Then assign it to users: `update public.profiles set court_id = '<court-id>' where id = '<user-id>';`
   (or pass `court_id` in `options.data` on `supabase.auth.signUp()` — see
   `handle_new_user()` in `0002_courts.sql`.)

3. **Confirm the Storage buckets exist.** Dashboard → Storage should show
   `documents` (private, 25 MB limit) and `avatars` (public, 5 MB limit).
   The `insert into storage.buckets ... on conflict do nothing` in
   `0011_storage.sql` creates them; this step is just to verify.

4. **Set Auth URLs.** Dashboard → Authentication → URL Configuration:
   - Site URL → your deployed app origin (or `http://localhost:5173` for
     local dev).
   - Redirect URLs → add the same origin. This is what
     `resetPasswordForEmail`'s `redirectTo` (in `src/hooks/use-auth.ts`)
     depends on for the forgot-password flow to land back on `/login`.

5. **Point the frontend at this project.** In the app root, copy
   `.env.example` to `.env` and fill in Project Settings → API → Project
   URL / anon public key.

6. **Regenerate frontend types against the live schema** (optional —
   `src/types/database.types.ts` is already hand-authored to match these
   11 migrations exactly, but once the CLI is linked you can keep it in
   sync automatically):

   ```bash
   SUPABASE_PROJECT_ID=<your-project-ref> npm run supabase:types
   ```

## Design notes worth knowing before you build on this

- **Court-scoped RLS.** `my_court_id()` / `user_can_access_case()` /
  `user_can_access_bench_note()` are the three functions basically every
  policy in 0003 onward is built from. A magistrate or clerk only ever
  sees rows in their own `court_id`; admins see everything.
- **Bench note privacy.** `bench_notes.is_private` (default `true`)
  restricts a note to its author until explicitly shared by flipping it
  to `false` — at which point it becomes visible to the rest of the
  author's court (or anyone with access to the note's case, if it's
  attached to one).
- **`ON DELETE RESTRICT` on judicial content.** `cases.created_by`,
  `bench_notes.author_id`, and `documents.uploaded_by` all use `RESTRICT`
  rather than `CASCADE` — you cannot delete a Supabase auth user who has
  filed cases, written notes, or uploaded documents without first
  reassigning or archiving that content. Deactivate accounts via
  `profiles.is_active = false` instead of deleting them.
- **`statutes` / `case_law` are curated, not per-court.** They're shared
  across every court and writable only by admins — treat them as the
  platform's canonical legal reference set, not user content.
- **Full-text search** uses generated `tsvector` columns (`GENERATED
  ALWAYS ... STORED`) with GIN indexes, so it updates automatically on
  write with no extra application code. Query it via the RPCs in
  `0010_search.sql` (e.g. `supabase.rpc('global_search', { p_query: 'search terms' })`),
  not by querying `search_vector` directly.
- **`content_text` on `bench_notes` is client-supplied.** TipTap's
  `editor.getJSON()` goes in `content`; call `editor.getText()` for the
  same save and send it as `content_text` — that's what feeds the search
  index, since extracting plain text from arbitrary ProseMirror JSON in
  SQL isn't practical.
- **Audit log is admin-only and append-only.** No one — including
  admins — has insert/update/delete access; every row comes from
  `audit_trigger_fn()`, which runs as `SECURITY DEFINER` off the table
  triggers in `0009_audit_log.sql`.
