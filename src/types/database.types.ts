/**
 * Hand-reconstructed from the LIVE Supabase project (gipijpeahkznfwitjccy)
 * schema as of migration 0048_audit_extensions (applied version
 * 20260811031037), via direct `information_schema.columns` /
 * `pg_enum` / FK-constraint / `pg_proc` introspection queries.
 *
 * WHY THIS IS HAND-WRITTEN, NOT CLI-GENERATED:
 * This sandbox environment blocks both the `generate_typescript_types`
 * MCP tool's full output (truncated to a host-side temp path this
 * environment cannot read) and `npm`/`npx` access to the public npm
 * registry (403), so the `supabase` CLI cannot be installed here to run
 * `npm run supabase:types`. Every table, column, type, nullability,
 * default, enum, foreign key, and function signature below was verified
 * directly against live Postgres system catalogs in this session — this
 * is not guessed or carried over from the prior (stale, pre-0013) file.
 *
 * SIMPLIFICATION DISCLOSED: `Insert`/`Update` optionality is derived
 * mechanically (nullable OR has a default OR generated => optional),
 * which is what the real generator does too, but CHECK-constraint-based
 * string unions (e.g. `docket_matter_parties.party_type`/`role`) are
 * intentionally left as `string` rather than invented literal unions,
 * since the real generator does not infer those from plain `text`
 * columns either. See the comment above `docket_matter_parties` for the
 * live constraint values.
 *
 * RECOMMENDATION: run the official `npm run supabase:types` (or
 * `supabase gen types typescript --project-id gipijpeahkznfwitjccy`)
 * from an environment with npm-registry access to obtain the fully
 * authoritative, tool-generated version of this file when convenient.
 * This file should be functionally equivalent for all tables that exist
 * today.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"];
          actor_id: string | null;
          created_at: string;
          id: number;
          new_data: Json | null;
          old_data: Json | null;
          record_id: string | null;
          table_name: string;
        };
        Insert: {
          action: Database["public"]["Enums"]["audit_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          new_data?: Json | null;
          old_data?: Json | null;
          record_id?: string | null;
          table_name: string;
        };
        Update: {
          action?: Database["public"]["Enums"]["audit_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          new_data?: Json | null;
          old_data?: Json | null;
          record_id?: string | null;
          table_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bench_note_tags: {
        Row: {
          bench_note_id: string;
          created_at: string;
          tag_id: string;
        };
        Insert: {
          bench_note_id: string;
          created_at?: string;
          tag_id: string;
        };
        Update: {
          bench_note_id?: string;
          created_at?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bench_note_tags_bench_note_id_fkey";
            columns: ["bench_note_id"];
            isOneToOne: false;
            referencedRelation: "bench_notes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bench_note_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * Polymorphic since 0040: `case_id` is GONE. Parent is
       * `entity_type` ('docket_matter' | 'judgment' | 'case_law' |
       * 'quick_code' | 'bench_note' | 'case') + `entity_id`. `is_private`
       * is inert for visibility (author-only regardless); do not use it
       * to gate display.
       */
      bench_notes: {
        Row: {
          author_id: string;
          content: Json;
          content_text: string;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          is_private: boolean;
          search_vector: unknown | null;
          status: Database["public"]["Enums"]["note_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          content?: Json;
          content_text?: string;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          is_private?: boolean;
          search_vector?: unknown | null;
          status?: Database["public"]["Enums"]["note_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          content?: Json;
          content_text?: string;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          is_private?: boolean;
          search_vector?: unknown | null;
          status?: Database["public"]["Enums"]["note_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bench_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** entity_id has no FK — polymorphic across the 7 approved entity types. */
      bookmarks: {
        Row: {
          created_at: string;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["bookmark_entity_type"];
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["bookmark_entity_type"];
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          entity_id?: string;
          entity_type?: Database["public"]["Enums"]["bookmark_entity_type"];
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookmarks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** owner_id IS NULL => canonical (shared) row; owner_id set => personal/private row. */
      case_law: {
        Row: {
          case_name: string;
          citation: string;
          court: string;
          created_at: string;
          created_by: string | null;
          decided_date: string | null;
          full_text: string | null;
          id: string;
          is_discoverable: boolean;
          jurisdiction: string;
          owner_id: string | null;
          search_vector: unknown | null;
          source_url: string | null;
          summary: string | null;
          updated_at: string;
        };
        Insert: {
          case_name: string;
          citation: string;
          court: string;
          created_at?: string;
          created_by?: string | null;
          decided_date?: string | null;
          full_text?: string | null;
          id?: string;
          is_discoverable?: boolean;
          jurisdiction: string;
          owner_id?: string | null;
          search_vector?: unknown | null;
          source_url?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Update: {
          case_name?: string;
          citation?: string;
          court?: string;
          created_at?: string;
          created_by?: string | null;
          decided_date?: string | null;
          full_text?: string | null;
          id?: string;
          is_discoverable?: boolean;
          jurisdiction?: string;
          owner_id?: string | null;
          search_vector?: unknown | null;
          source_url?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_law_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_law_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      case_law_annotations: {
        Row: {
          annotation_text: string;
          case_law_id: string;
          created_at: string;
          id: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          annotation_text: string;
          case_law_id: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Update: {
          annotation_text?: string;
          case_law_id?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_law_annotations_case_law_id_fkey";
            columns: ["case_law_id"];
            isOneToOne: false;
            referencedRelation: "case_law";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_law_annotations_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      case_law_tags: {
        Row: {
          case_law_id: string;
          created_at: string;
          tag_id: string;
        };
        Insert: {
          case_law_id: string;
          created_at?: string;
          tag_id: string;
        };
        Update: {
          case_law_id?: string;
          created_at?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_law_tags_case_law_id_fkey";
            columns: ["case_law_id"];
            isOneToOne: false;
            referencedRelation: "case_law";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_law_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Legacy pre-Docket table. Not part of the current Docket workspace model — do not build new features on it. */
      case_parties: {
        Row: {
          attorney_name: string | null;
          case_id: string;
          contact_info: string | null;
          created_at: string;
          full_name: string;
          id: string;
          role: Database["public"]["Enums"]["party_role"];
        };
        Insert: {
          attorney_name?: string | null;
          case_id: string;
          contact_info?: string | null;
          created_at?: string;
          full_name: string;
          id?: string;
          role?: Database["public"]["Enums"]["party_role"];
        };
        Update: {
          attorney_name?: string | null;
          case_id?: string;
          contact_info?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          role?: Database["public"]["Enums"]["party_role"];
        };
        Relationships: [
          {
            foreignKeyName: "case_parties_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
        ];
      };
      case_tags: {
        Row: {
          case_id: string;
          created_at: string;
          tag_id: string;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          tag_id: string;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_tags_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Legacy pre-Docket table, superseded by docket_matters. Retained for compatibility, not the active Docket model. */
      cases: {
        Row: {
          assigned_magistrate_id: string | null;
          case_number: string;
          case_type: string | null;
          closed_date: string | null;
          court_id: string;
          created_at: string;
          created_by: string;
          description: string | null;
          filed_date: string | null;
          id: string;
          search_vector: unknown | null;
          status: Database["public"]["Enums"]["case_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_magistrate_id?: string | null;
          case_number: string;
          case_type?: string | null;
          closed_date?: string | null;
          court_id: string;
          created_at?: string;
          created_by: string;
          description?: string | null;
          filed_date?: string | null;
          id?: string;
          search_vector?: unknown | null;
          status?: Database["public"]["Enums"]["case_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_magistrate_id?: string | null;
          case_number?: string;
          case_type?: string | null;
          closed_date?: string | null;
          court_id?: string;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          filed_date?: string | null;
          id?: string;
          search_vector?: unknown | null;
          status?: Database["public"]["Enums"]["case_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cases_assigned_magistrate_id_fkey";
            columns: ["assigned_magistrate_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_court_id_fkey";
            columns: ["court_id"];
            isOneToOne: false;
            referencedRelation: "courts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Legacy table; still directly references bench_note_id (pre-polymorphic). Tier 4, not audited, not built upon. */
      comments: {
        Row: {
          author_id: string;
          bench_note_id: string | null;
          case_id: string | null;
          content: string;
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          bench_note_id?: string | null;
          case_id?: string | null;
          content: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          bench_note_id?: string | null;
          case_id?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_bench_note_id_fkey";
            columns: ["bench_note_id"];
            isOneToOne: false;
            referencedRelation: "bench_notes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
        ];
      };
      courts: {
        Row: {
          address: string | null;
          created_at: string;
          district_id: string | null;
          id: string;
          is_active: boolean;
          jurisdiction: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          district_id?: string | null;
          id?: string;
          is_active?: boolean;
          jurisdiction: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          district_id?: string | null;
          id?: string;
          is_active?: boolean;
          jurisdiction?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "courts_district_id_fkey";
            columns: ["district_id"];
            isOneToOne: false;
            referencedRelation: "magisterial_districts";
            referencedColumns: ["id"];
          },
        ];
      };
      docket_events: {
        Row: {
          created_at: string;
          created_by: string;
          docket_matter_id: string;
          event_status: string;
          event_type: string | null;
          external_calendar_event_id: string | null;
          external_calendar_provider: string | null;
          external_calendar_synced_at: string | null;
          id: string;
          last_updated_by: string | null;
          location: string | null;
          notes: string | null;
          orders_made_at_event: string | null;
          outcome_at_event: string | null;
          presiding_magistrate_id: string | null;
          scheduled_date: string;
          scheduled_time: string | null;
          stage_at_event: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          docket_matter_id: string;
          event_status?: string;
          event_type?: string | null;
          external_calendar_event_id?: string | null;
          external_calendar_provider?: string | null;
          external_calendar_synced_at?: string | null;
          id?: string;
          last_updated_by?: string | null;
          location?: string | null;
          notes?: string | null;
          orders_made_at_event?: string | null;
          outcome_at_event?: string | null;
          presiding_magistrate_id?: string | null;
          scheduled_date: string;
          scheduled_time?: string | null;
          stage_at_event?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          docket_matter_id?: string;
          event_status?: string;
          event_type?: string | null;
          external_calendar_event_id?: string | null;
          external_calendar_provider?: string | null;
          external_calendar_synced_at?: string | null;
          id?: string;
          last_updated_by?: string | null;
          location?: string | null;
          notes?: string | null;
          orders_made_at_event?: string | null;
          outcome_at_event?: string | null;
          presiding_magistrate_id?: string | null;
          scheduled_date?: string;
          scheduled_time?: string | null;
          stage_at_event?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "docket_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_events_docket_matter_id_fkey";
            columns: ["docket_matter_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_events_last_updated_by_fkey";
            columns: ["last_updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_events_presiding_magistrate_id_fkey";
            columns: ["presiding_magistrate_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** "reason" is free text with an established convention (e.g. 'retained_part_heard'); no DB enum. */
      docket_matter_assignments: {
        Row: {
          created_at: string;
          docket_matter_id: string;
          ended_at: string | null;
          granted_by: string | null;
          id: string;
          notes: string | null;
          profile_id: string | null;
          reason: string;
          started_at: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          docket_matter_id: string;
          ended_at?: string | null;
          granted_by?: string | null;
          id?: string;
          notes?: string | null;
          profile_id?: string | null;
          reason?: string;
          started_at?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          docket_matter_id?: string;
          ended_at?: string | null;
          granted_by?: string | null;
          id?: string;
          notes?: string | null;
          profile_id?: string | null;
          reason?: string;
          started_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "docket_matter_assignments_docket_matter_id_fkey";
            columns: ["docket_matter_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_assignments_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_assignments_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      docket_matter_case_law: {
        Row: {
          case_law_id: string;
          created_at: string;
          created_by: string;
          docket_matter_id: string;
          id: string;
        };
        Insert: {
          case_law_id: string;
          created_at?: string;
          created_by?: string;
          docket_matter_id: string;
          id?: string;
        };
        Update: {
          case_law_id?: string;
          created_at?: string;
          created_by?: string;
          docket_matter_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "docket_matter_case_law_case_law_id_fkey";
            columns: ["case_law_id"];
            isOneToOne: false;
            referencedRelation: "case_law";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_case_law_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_case_law_docket_matter_id_fkey";
            columns: ["docket_matter_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
        ];
      };
      docket_matter_judgments: {
        Row: {
          created_at: string;
          created_by: string;
          docket_matter_id: string;
          id: string;
          judgment_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          docket_matter_id: string;
          id?: string;
          judgment_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          docket_matter_id?: string;
          id?: string;
          judgment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "docket_matter_judgments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_judgments_docket_matter_id_fkey";
            columns: ["docket_matter_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_judgments_judgment_id_fkey";
            columns: ["judgment_id"];
            isOneToOne: false;
            referencedRelation: "judgments";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * `party_type` and `role` are plain `text` with live CHECK constraints
       * (not Postgres enums), verified this session:
       *   party_type: 'individual' | 'organization' | 'government_body' | 'estate' | 'other'
       *   role: 'accused' | 'complainant' | 'applicant' | 'respondent' | 'plaintiff'
       *       | 'defendant' | 'petitioner' | 'appellant' | 'appellee' | 'landlord'
       *       | 'tenant' | 'child' | 'other'
       * Enforce these in the frontend form (zod) — TypeScript alone won't.
       * `contact_info` must never be exposed outside lawful access paths.
       */
      docket_matter_parties: {
        Row: {
          attorney_name: string | null;
          contact_info: string | null;
          created_at: string;
          created_by: string;
          docket_matter_id: string;
          full_name: string;
          id: string;
          last_updated_by: string | null;
          party_status: string;
          party_type: string;
          role: string;
          updated_at: string;
        };
        Insert: {
          attorney_name?: string | null;
          contact_info?: string | null;
          created_at?: string;
          created_by?: string;
          docket_matter_id: string;
          full_name: string;
          id?: string;
          last_updated_by?: string | null;
          party_status?: string;
          party_type?: string;
          role: string;
          updated_at?: string;
        };
        Update: {
          attorney_name?: string | null;
          contact_info?: string | null;
          created_at?: string;
          created_by?: string;
          docket_matter_id?: string;
          full_name?: string;
          id?: string;
          last_updated_by?: string | null;
          party_status?: string;
          party_type?: string;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "docket_matter_parties_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_parties_docket_matter_id_fkey";
            columns: ["docket_matter_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_parties_last_updated_by_fkey";
            columns: ["last_updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Case-insensitive de-dup is enforced by the DB, not the frontend. Do not revive the legacy global `tags` table for Docket. */
      docket_matter_tags: {
        Row: {
          created_at: string;
          created_by: string;
          docket_matter_id: string;
          id: string;
          tag_name: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          docket_matter_id: string;
          id?: string;
          tag_name: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          docket_matter_id?: string;
          id?: string;
          tag_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "docket_matter_tags_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matter_tags_docket_matter_id_fkey";
            columns: ["docket_matter_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Access = current Court assignment OR retained assignment OR active Docket share (three-path predicate). Use the RLS helper RPCs, not ad-hoc frontend checks. */
      docket_matters: {
        Row: {
          case_number: string;
          charge_or_issue: string | null;
          court_id: string;
          created_at: string;
          created_by: string;
          district_id: string;
          id: string;
          last_updated_by: string | null;
          matter_title: string;
          orders_summary: string | null;
          outcome: string | null;
          search_vector: unknown | null;
          status: Database["public"]["Enums"]["docket_matter_status"];
          updated_at: string;
        };
        Insert: {
          case_number: string;
          charge_or_issue?: string | null;
          court_id: string;
          created_at?: string;
          created_by?: string;
          district_id: string;
          id?: string;
          last_updated_by?: string | null;
          matter_title: string;
          orders_summary?: string | null;
          outcome?: string | null;
          search_vector?: unknown | null;
          status?: Database["public"]["Enums"]["docket_matter_status"];
          updated_at?: string;
        };
        Update: {
          case_number?: string;
          charge_or_issue?: string | null;
          court_id?: string;
          created_at?: string;
          created_by?: string;
          district_id?: string;
          id?: string;
          last_updated_by?: string | null;
          matter_title?: string;
          orders_summary?: string | null;
          outcome?: string | null;
          search_vector?: unknown | null;
          status?: Database["public"]["Enums"]["docket_matter_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "docket_matters_court_id_fkey";
            columns: ["court_id"];
            isOneToOne: false;
            referencedRelation: "courts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matters_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matters_district_id_fkey";
            columns: ["district_id"];
            isOneToOne: false;
            referencedRelation: "magisterial_districts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "docket_matters_last_updated_by_fkey";
            columns: ["last_updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Polymorphic (entity_type/entity_id, 6 approved parent types); no FK on entity_id by design. Delete order: Storage API first, then this row — never delete the storage object via SQL. */
      documents: {
        Row: {
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          file_name: string;
          file_path: string;
          file_size: number;
          id: string;
          mime_type: string;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          file_name: string;
          file_path: string;
          file_size: number;
          id?: string;
          mime_type: string;
          uploaded_by: string;
        };
        Update: {
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          file_name?: string;
          file_path?: string;
          file_size?: number;
          id?: string;
          mime_type?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      judgment_tags: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          judgment_id: string;
          tag_name: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          judgment_id: string;
          tag_name: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          judgment_id?: string;
          tag_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "judgment_tags_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "judgment_tags_judgment_id_fkey";
            columns: ["judgment_id"];
            isOneToOne: false;
            referencedRelation: "judgments";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Visibility = owner-or-is_discoverable only, no admin bypass. `status`/finalized_* govern the atomic unlock-then-edit-separately lifecycle model — mirror it in the UI, do not invent versioning. */
      judgments: {
        Row: {
          case_number: string | null;
          citation: string | null;
          content: Json | null;
          content_text: string | null;
          court_name: string | null;
          created_at: string;
          finalized_at: string | null;
          finalized_by: string | null;
          id: string;
          is_discoverable: boolean;
          judgment_date: string | null;
          owner_id: string;
          search_vector: unknown | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          case_number?: string | null;
          citation?: string | null;
          content?: Json | null;
          content_text?: string | null;
          court_name?: string | null;
          created_at?: string;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          is_discoverable?: boolean;
          judgment_date?: string | null;
          owner_id?: string;
          search_vector?: unknown | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          case_number?: string | null;
          citation?: string | null;
          content?: Json | null;
          content_text?: string | null;
          court_name?: string | null;
          created_at?: string;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          is_discoverable?: boolean;
          judgment_date?: string | null;
          owner_id?: string;
          search_vector?: unknown | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "judgments_finalized_by_fkey";
            columns: ["finalized_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "judgments_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      magisterial_districts: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /** A magistrate's current-Court context. `my_court_id()` / `can_access_court()` read from here — prefer those RPCs over querying this table directly for authority checks. */
      magistrate_courts: {
        Row: {
          assignment_type: string;
          court_id: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          profile_id: string;
          started_at: string;
          updated_at: string;
        };
        Insert: {
          assignment_type?: string;
          court_id: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          profile_id: string;
          started_at?: string;
          updated_at?: string;
        };
        Update: {
          assignment_type?: string;
          court_id?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          profile_id?: string;
          started_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "magistrate_courts_court_id_fkey";
            columns: ["court_id"];
            isOneToOne: false;
            referencedRelation: "courts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "magistrate_courts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** `id` also has a cross-schema FK to `auth.users(id)` not reflected in `public`-schema Relationships. */
      profiles: {
        Row: {
          avatar_url: string | null;
          court_id: string | null;
          court_name: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          jurisdiction: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          court_id?: string | null;
          court_name?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          jurisdiction?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          court_id?: string | null;
          court_name?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          jurisdiction?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_court_id_fkey";
            columns: ["court_id"];
            isOneToOne: false;
            referencedRelation: "courts";
            referencedColumns: ["id"];
          },
        ];
      };
      quick_code_case_law: {
        Row: {
          case_law_id: string;
          created_at: string;
          created_by: string;
          id: string;
          quick_code_id: string;
        };
        Insert: {
          case_law_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          quick_code_id: string;
        };
        Update: {
          case_law_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          quick_code_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quick_code_case_law_case_law_id_fkey";
            columns: ["case_law_id"];
            isOneToOne: false;
            referencedRelation: "case_law";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quick_code_case_law_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quick_code_case_law_quick_code_id_fkey";
            columns: ["quick_code_id"];
            isOneToOne: false;
            referencedRelation: "quick_codes";
            referencedColumns: ["id"];
          },
        ];
      };
      quick_code_docket_matters: {
        Row: {
          created_at: string;
          created_by: string;
          docket_matter_id: string;
          id: string;
          quick_code_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          docket_matter_id: string;
          id?: string;
          quick_code_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          docket_matter_id?: string;
          id?: string;
          quick_code_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quick_code_docket_matters_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quick_code_docket_matters_docket_matter_id_fkey";
            columns: ["docket_matter_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quick_code_docket_matters_quick_code_id_fkey";
            columns: ["quick_code_id"];
            isOneToOne: false;
            referencedRelation: "quick_codes";
            referencedColumns: ["id"];
          },
        ];
      };
      quick_code_judgments: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          judgment_id: string;
          quick_code_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          judgment_id: string;
          quick_code_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          judgment_id?: string;
          quick_code_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quick_code_judgments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quick_code_judgments_judgment_id_fkey";
            columns: ["judgment_id"];
            isOneToOne: false;
            referencedRelation: "judgments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quick_code_judgments_quick_code_id_fkey";
            columns: ["quick_code_id"];
            isOneToOne: false;
            referencedRelation: "quick_codes";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Owner-only CRUD, no Court/Docket/admin bypass — do not reopen. */
      quick_codes: {
        Row: {
          code_word: string;
          content: string;
          created_at: string;
          description: string | null;
          id: string;
          owner_id: string;
          search_vector: unknown | null;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          code_word: string;
          content: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id?: string;
          search_vector?: unknown | null;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          code_word?: string;
          content?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id?: string;
          search_vector?: unknown | null;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quick_codes_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** `item_id` is FK-constrained to docket_matters only — Sharing is currently Docket-Matter-specific, not a general polymorphic mechanism. `permission` is 'view' | 'edit' (text, not enum) by convention. No resharing. */
      shares: {
        Row: {
          created_at: string;
          granted_by: string | null;
          id: string;
          item_id: string;
          item_type: string;
          permission: string;
          recipient_id: string | null;
          revoked_at: string | null;
        };
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          item_id: string;
          item_type: string;
          permission: string;
          recipient_id?: string | null;
          revoked_at?: string | null;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          item_id?: string;
          item_type?: string;
          permission?: string;
          recipient_id?: string | null;
          revoked_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shares_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shares_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "docket_matters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shares_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      statute_tags: {
        Row: {
          created_at: string;
          statute_id: string;
          tag_id: string;
        };
        Insert: {
          created_at?: string;
          statute_id: string;
          tag_id: string;
        };
        Update: {
          created_at?: string;
          statute_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "statute_tags_statute_id_fkey";
            columns: ["statute_id"];
            isOneToOne: false;
            referencedRelation: "statutes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "statute_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      statutes: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          effective_date: string | null;
          full_text: string | null;
          id: string;
          jurisdiction: string;
          search_vector: unknown | null;
          source_url: string | null;
          summary: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          effective_date?: string | null;
          full_text?: string | null;
          id?: string;
          jurisdiction: string;
          search_vector?: unknown | null;
          source_url?: string | null;
          summary?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          effective_date?: string | null;
          full_text?: string | null;
          id?: string;
          jurisdiction?: string;
          search_vector?: unknown | null;
          source_url?: string | null;
          summary?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "statutes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Legacy global tag table (used by cases/case_law/bench_notes/statutes). Docket uses its own `docket_matter_tags`/`judgment_tags` free-text model instead — do not conflate the two. */
      tags: {
        Row: {
          color: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tags_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_access_court: { Args: { p_court_id: string }; Returns: boolean };
      can_edit_case_law: { Args: { p_case_law_id: string }; Returns: boolean };
      can_edit_docket_matter: {
        Args: { p_docket_matter_id: string };
        Returns: boolean;
      };
      can_edit_judgment: { Args: { p_judgment_id: string }; Returns: boolean };
      can_view_case_law: { Args: { p_case_law_id: string }; Returns: boolean };
      can_view_docket_matter: {
        Args: { p_docket_matter_id: string };
        Returns: boolean;
      };
      can_view_judgment: { Args: { p_judgment_id: string }; Returns: boolean };
      global_search: {
        Args: { p_limit?: number; p_query: string };
        Returns: Database["public"]["CompositeTypes"]["search_result"][];
      };
      has_docket_matter_authority: {
        Args: { p_docket_matter_id: string };
        Returns: boolean;
      };
      has_docket_share: {
        Args: { p_docket_matter_id: string; p_required_permission?: string };
        Returns: boolean;
      };
      has_retained_assignment: {
        Args: { p_docket_matter_id: string };
        Returns: boolean;
      };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      my_court_id: { Args: Record<string, never>; Returns: string };
      /** Prefer this over a broad `profiles` SELECT for displaying who a Docket assignment belongs to. */
      resolve_docket_assignment_identity: {
        Args: { p_assignment_id: string };
        Returns: { profile_id: string; display_name: string }[];
      };
      /** Prefer this over a broad `profiles` SELECT for displaying Share grantor/recipient identity. */
      resolve_docket_share_identity: {
        Args: { p_share_id: string };
        Returns: {
          recipient_id: string;
          recipient_display_name: string;
          granted_by: string;
          grantor_display_name: string;
        }[];
      };
      search_bench_notes: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          entity_type: string;
          entity_id: string;
          title: string;
          rank: number;
          headline: string;
        }[];
      };
      search_case_law: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          case_name: string;
          citation: string;
          court: string;
          jurisdiction: string;
          summary: string;
          rank: number;
          headline: string;
        }[];
      };
      search_cases: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          case_number: string;
          title: string;
          status: Database["public"]["Enums"]["case_status"];
          rank: number;
          headline: string;
        }[];
      };
      search_docket_matters: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          case_number: string;
          matter_title: string;
          status: Database["public"]["Enums"]["docket_matter_status"];
          rank: number;
          headline: string;
        }[];
      };
      search_judgments: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          title: string;
          case_number: string;
          citation: string;
          status: string;
          rank: number;
          headline: string;
        }[];
      };
      search_quick_codes: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          code_word: string;
          title: string;
          rank: number;
          headline: string;
        }[];
      };
      search_statutes: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          code: string;
          title: string;
          jurisdiction: string;
          summary: string;
          rank: number;
          headline: string;
        }[];
      };
      user_can_access_bench_note: {
        Args: { p_note_id: string };
        Returns: boolean;
      };
      user_can_access_case: { Args: { p_case_id: string }; Returns: boolean };
    };
    Enums: {
      audit_action: "insert" | "update" | "delete";
      bookmark_entity_type:
        | "case"
        | "bench_note"
        | "statute"
        | "case_law"
        | "docket_matter"
        | "judgment"
        | "quick_code";
      case_status: "open" | "pending" | "closed" | "archived";
      docket_matter_status: "active" | "stayed" | "completed" | "archived";
      note_status: "draft" | "published";
      party_role:
        | "plaintiff"
        | "defendant"
        | "petitioner"
        | "respondent"
        | "appellant"
        | "appellee"
        | "witness"
        | "other";
      user_role: "magistrate" | "clerk" | "admin";
    };
    CompositeTypes: {
      search_result: {
        entity_type: string | null;
        id: string | null;
        title: string | null;
        subtitle: string | null;
        headline: string | null;
        rank: number | null;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      audit_action: ["insert", "update", "delete"],
      bookmark_entity_type: [
        "case",
        "bench_note",
        "statute",
        "case_law",
        "docket_matter",
        "judgment",
        "quick_code",
      ],
      case_status: ["open", "pending", "closed", "archived"],
      docket_matter_status: ["active", "stayed", "completed", "archived"],
      note_status: ["draft", "published"],
      party_role: [
        "plaintiff",
        "defendant",
        "petitioner",
        "respondent",
        "appellant",
        "appellee",
        "witness",
        "other",
      ],
      user_role: ["magistrate", "clerk", "admin"],
    },
  },
} as const;

// --- BenchBook convenience aliases (not part of the generated output) -----

export type Profile = Tables<"profiles">;
export type Court = Tables<"courts">;
export type MagisterialDistrict = Tables<"magisterial_districts">;
export type MagistrateCourt = Tables<"magistrate_courts">;
export type Case = Tables<"cases">;
export type CaseParty = Tables<"case_parties">;
export type BenchNote = Tables<"bench_notes">;
export type Statute = Tables<"statutes">;
export type CaseLaw = Tables<"case_law">;
export type CaseLawAnnotation = Tables<"case_law_annotations">;
export type Tag = Tables<"tags">;
export type Document = Tables<"documents">;
export type Comment = Tables<"comments">;
export type Bookmark = Tables<"bookmarks">;
export type AuditLogEntry = Tables<"audit_log">;
export type SearchResult = CompositeTypes<"search_result">;

export type DocketMatter = Tables<"docket_matters">;
export type DocketEvent = Tables<"docket_events">;
export type DocketMatterParty = Tables<"docket_matter_parties">;
export type DocketMatterTag = Tables<"docket_matter_tags">;
export type DocketMatterAssignment = Tables<"docket_matter_assignments">;
export type DocketMatterJudgment = Tables<"docket_matter_judgments">;
export type DocketMatterCaseLaw = Tables<"docket_matter_case_law">;
export type Judgment = Tables<"judgments">;
export type JudgmentTag = Tables<"judgment_tags">;
export type QuickCode = Tables<"quick_codes">;
export type QuickCodeDocketMatter = Tables<"quick_code_docket_matters">;
export type QuickCodeJudgment = Tables<"quick_code_judgments">;
export type QuickCodeCaseLaw = Tables<"quick_code_case_law">;
export type Share = Tables<"shares">;
