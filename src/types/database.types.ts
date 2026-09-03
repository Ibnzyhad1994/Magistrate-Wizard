export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          prev_hash: string | null
          row_hash: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          prev_hash?: string | null
          row_hash?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          prev_hash?: string | null
          row_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_event_log: {
        Row: {
          actor_id: string | null
          created_at: string
          email: string | null
          event_type: Database["public"]["Enums"]["auth_event_type"]
          id: number
          user_agent: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          email?: string | null
          event_type: Database["public"]["Enums"]["auth_event_type"]
          id?: never
          user_agent?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          email?: string | null
          event_type?: Database["public"]["Enums"]["auth_event_type"]
          id?: never
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auth_event_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bench_note_tags: {
        Row: {
          bench_note_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          bench_note_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          bench_note_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bench_note_tags_bench_note_id_fkey"
            columns: ["bench_note_id"]
            isOneToOne: false
            referencedRelation: "bench_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bench_note_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      bench_notes: {
        Row: {
          author_id: string
          content: Json
          content_text: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          is_private: boolean
          search_vector: unknown
          status: Database["public"]["Enums"]["note_status"]
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content?: Json
          content_text?: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          is_private?: boolean
          search_vector?: unknown
          status?: Database["public"]["Enums"]["note_status"]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: Json
          content_text?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          is_private?: boolean
          search_vector?: unknown
          status?: Database["public"]["Enums"]["note_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bench_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookmarks: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["bookmark_entity_type"]
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["bookmark_entity_type"]
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["bookmark_entity_type"]
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_law: {
        Row: {
          case_name: string
          category_id: string | null
          citation: string
          content_quality_status: string
          court: string
          court_id: string | null
          created_at: string
          created_by: string | null
          decided_date: string | null
          disposition: string | null
          document_hash: string | null
          full_text: string | null
          id: string
          import_job_id: string | null
          is_discoverable: boolean
          issues: string | null
          judges: string | null
          jurisdiction: string
          jurisdiction_id: string | null
          key_passages: string | null
          neutral_citation: string | null
          original_filename: string | null
          owner_id: string | null
          parties: string | null
          principles: string | null
          reported_citation: string | null
          retrieved_at: string | null
          review_status: string
          search_vector: unknown
          source_id: string | null
          source_url: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          case_name: string
          category_id?: string | null
          citation: string
          content_quality_status?: string
          court: string
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_date?: string | null
          disposition?: string | null
          document_hash?: string | null
          full_text?: string | null
          id?: string
          import_job_id?: string | null
          is_discoverable?: boolean
          issues?: string | null
          judges?: string | null
          jurisdiction: string
          jurisdiction_id?: string | null
          key_passages?: string | null
          neutral_citation?: string | null
          original_filename?: string | null
          owner_id?: string | null
          parties?: string | null
          principles?: string | null
          reported_citation?: string | null
          retrieved_at?: string | null
          review_status?: string
          search_vector?: unknown
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          case_name?: string
          category_id?: string | null
          citation?: string
          content_quality_status?: string
          court?: string
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_date?: string | null
          disposition?: string | null
          document_hash?: string | null
          full_text?: string | null
          id?: string
          import_job_id?: string | null
          is_discoverable?: boolean
          issues?: string | null
          judges?: string | null
          jurisdiction?: string
          jurisdiction_id?: string | null
          key_passages?: string | null
          neutral_citation?: string | null
          original_filename?: string | null
          owner_id?: string | null
          parties?: string | null
          principles?: string | null
          reported_citation?: string | null
          retrieved_at?: string | null
          review_status?: string
          search_vector?: unknown
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_law_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "legal_case_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "legal_authority_courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "legal_jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      case_law_annotations: {
        Row: {
          annotation_text: string
          case_law_id: string
          created_at: string
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          annotation_text: string
          case_law_id: string
          created_at?: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          annotation_text?: string
          case_law_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_law_annotations_case_law_id_fkey"
            columns: ["case_law_id"]
            isOneToOne: false
            referencedRelation: "case_law"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_annotations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_law_tags: {
        Row: {
          case_law_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          case_law_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          case_law_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_law_tags_case_law_id_fkey"
            columns: ["case_law_id"]
            isOneToOne: false
            referencedRelation: "case_law"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_law_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      case_parties: {
        Row: {
          attorney_name: string | null
          case_id: string
          contact_info: string | null
          created_at: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["party_role"]
        }
        Insert: {
          attorney_name?: string | null
          case_id: string
          contact_info?: string | null
          created_at?: string
          full_name: string
          id?: string
          role?: Database["public"]["Enums"]["party_role"]
        }
        Update: {
          attorney_name?: string | null
          case_id?: string
          contact_info?: string | null
          created_at?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["party_role"]
        }
        Relationships: [
          {
            foreignKeyName: "case_parties_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_tags: {
        Row: {
          case_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_tags_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          assigned_magistrate_id: string | null
          case_number: string
          case_type: string | null
          closed_date: string | null
          court_id: string
          created_at: string
          created_by: string
          description: string | null
          filed_date: string | null
          id: string
          search_vector: unknown
          status: Database["public"]["Enums"]["case_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_magistrate_id?: string | null
          case_number: string
          case_type?: string | null
          closed_date?: string | null
          court_id: string
          created_at?: string
          created_by: string
          description?: string | null
          filed_date?: string | null
          id?: string
          search_vector?: unknown
          status?: Database["public"]["Enums"]["case_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_magistrate_id?: string | null
          case_number?: string
          case_type?: string | null
          closed_date?: string | null
          court_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          filed_date?: string | null
          id?: string
          search_vector?: unknown
          status?: Database["public"]["Enums"]["case_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_assigned_magistrate_id_fkey"
            columns: ["assigned_magistrate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clerk_access_requests: {
        Row: {
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_clerk_at: string | null
          notified_magistrate_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["clerk_access_request_status"]
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          court_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          note?: string | null
          notified_clerk_at?: string | null
          notified_magistrate_at?: string | null
          profile_id: string
          rejection_reason?: string | null
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["clerk_access_request_status"]
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          court_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          note?: string | null
          notified_clerk_at?: string | null
          notified_magistrate_at?: string | null
          profile_id?: string
          rejection_reason?: string | null
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["clerk_access_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clerk_access_requests_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clerk_access_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clerk_access_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clerk_courts: {
        Row: {
          approved_by: string
          court_id: string
          created_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          profile_id: string
          started_at: string
          updated_at: string
        }
        Insert: {
          approved_by: string
          court_id: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          profile_id: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          approved_by?: string
          court_id?: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          profile_id?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clerk_courts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clerk_courts_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clerk_courts_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clerk_courts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          bench_note_id: string | null
          case_id: string | null
          content: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          bench_note_id?: string | null
          case_id?: string | null
          content: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          bench_note_id?: string | null
          case_id?: string | null
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_bench_note_id_fkey"
            columns: ["bench_note_id"]
            isOneToOne: false
            referencedRelation: "bench_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          address: string | null
          created_at: string
          district_id: string | null
          id: string
          is_active: boolean
          jurisdiction: string
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          district_id?: string | null
          id?: string
          is_active?: boolean
          jurisdiction: string
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          district_id?: string | null
          id?: string
          is_active?: boolean
          jurisdiction?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courts_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "magisterial_districts"
            referencedColumns: ["id"]
          },
        ]
      }
      data_retention_policies: {
        Row: {
          action: string
          notes: string | null
          retention_days: number
          table_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action: string
          notes?: string | null
          retention_days: number
          table_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action?: string
          notes?: string | null
          retention_days?: number
          table_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      docket_capacity_overrides: {
        Row: {
          category_id: string | null
          configured_capacity: number
          created_at: string
          docket_event_id: string | null
          docket_matter_id: string
          id: string
          magistrate_profile_id: string
          reason: string | null
          scheduled_count_at_override: number
          scheduled_date: string
        }
        Insert: {
          category_id?: string | null
          configured_capacity: number
          created_at?: string
          docket_event_id?: string | null
          docket_matter_id: string
          id?: string
          magistrate_profile_id: string
          reason?: string | null
          scheduled_count_at_override: number
          scheduled_date: string
        }
        Update: {
          category_id?: string | null
          configured_capacity?: number
          created_at?: string
          docket_event_id?: string | null
          docket_matter_id?: string
          id?: string
          magistrate_profile_id?: string
          reason?: string | null
          scheduled_count_at_override?: number
          scheduled_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_capacity_overrides_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "docket_matter_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_capacity_overrides_docket_event_id_fkey"
            columns: ["docket_event_id"]
            isOneToOne: false
            referencedRelation: "docket_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_capacity_overrides_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_capacity_overrides_magistrate_profile_id_fkey"
            columns: ["magistrate_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_capacity_settings: {
        Row: {
          category_id: string
          created_at: string
          daily_capacity: number
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          daily_capacity: number
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          daily_capacity?: number
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_capacity_settings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "docket_matter_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_capacity_settings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_event_calendar_links: {
        Row: {
          created_at: string
          docket_event_id: string
          etag: string | null
          external_calendar_id: string
          external_event_id: string
          id: string
          profile_id: string
          provider: string
          synced_at: string | null
        }
        Insert: {
          created_at?: string
          docket_event_id: string
          etag?: string | null
          external_calendar_id: string
          external_event_id: string
          id?: string
          profile_id?: string
          provider: string
          synced_at?: string | null
        }
        Update: {
          created_at?: string
          docket_event_id?: string
          etag?: string | null
          external_calendar_id?: string
          external_event_id?: string
          id?: string
          profile_id?: string
          provider?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docket_event_calendar_links_docket_event_id_fkey"
            columns: ["docket_event_id"]
            isOneToOne: false
            referencedRelation: "docket_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_event_calendar_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_events: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string
          docket_matter_id: string
          event_status: string
          event_type: string | null
          external_calendar_event_id: string | null
          external_calendar_provider: string | null
          external_calendar_synced_at: string | null
          id: string
          last_updated_by: string | null
          location: string | null
          notes: string | null
          orders_made_at_event: string | null
          outcome_at_event: string | null
          presiding_magistrate_id: string | null
          scheduled_date: string
          scheduled_time: string | null
          stage_at_event: string | null
          updated_at: string
          witnesses_called: number | null
          witnesses_completed: number | null
          witnesses_partly_heard: number | null
          witnesses_remaining: number | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string
          docket_matter_id: string
          event_status?: string
          event_type?: string | null
          external_calendar_event_id?: string | null
          external_calendar_provider?: string | null
          external_calendar_synced_at?: string | null
          id?: string
          last_updated_by?: string | null
          location?: string | null
          notes?: string | null
          orders_made_at_event?: string | null
          outcome_at_event?: string | null
          presiding_magistrate_id?: string | null
          scheduled_date: string
          scheduled_time?: string | null
          stage_at_event?: string | null
          updated_at?: string
          witnesses_called?: number | null
          witnesses_completed?: number | null
          witnesses_partly_heard?: number | null
          witnesses_remaining?: number | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string
          docket_matter_id?: string
          event_status?: string
          event_type?: string | null
          external_calendar_event_id?: string | null
          external_calendar_provider?: string | null
          external_calendar_synced_at?: string | null
          id?: string
          last_updated_by?: string | null
          location?: string | null
          notes?: string | null
          orders_made_at_event?: string | null
          outcome_at_event?: string | null
          presiding_magistrate_id?: string | null
          scheduled_date?: string
          scheduled_time?: string | null
          stage_at_event?: string | null
          updated_at?: string
          witnesses_called?: number | null
          witnesses_completed?: number | null
          witnesses_partly_heard?: number | null
          witnesses_remaining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "docket_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "docket_matter_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_events_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_events_last_updated_by_fkey"
            columns: ["last_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_events_presiding_magistrate_id_fkey"
            columns: ["presiding_magistrate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_matter_assignments: {
        Row: {
          created_at: string
          docket_matter_id: string
          ended_at: string | null
          granted_by: string | null
          id: string
          notes: string | null
          profile_id: string | null
          reason: string
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          docket_matter_id: string
          ended_at?: string | null
          granted_by?: string | null
          id?: string
          notes?: string | null
          profile_id?: string | null
          reason?: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          docket_matter_id?: string
          ended_at?: string | null
          granted_by?: string | null
          id?: string
          notes?: string | null
          profile_id?: string | null
          reason?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_matter_assignments_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_assignments_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_matter_case_law: {
        Row: {
          case_law_id: string
          created_at: string
          created_by: string
          docket_matter_id: string
          id: string
        }
        Insert: {
          case_law_id: string
          created_at?: string
          created_by?: string
          docket_matter_id: string
          id?: string
        }
        Update: {
          case_law_id?: string
          created_at?: string
          created_by?: string
          docket_matter_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_matter_case_law_case_law_id_fkey"
            columns: ["case_law_id"]
            isOneToOne: false
            referencedRelation: "case_law"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_case_law_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_case_law_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_matter_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      docket_matter_judgments: {
        Row: {
          created_at: string
          created_by: string
          docket_matter_id: string
          id: string
          judgment_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          docket_matter_id: string
          id?: string
          judgment_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          docket_matter_id?: string
          id?: string
          judgment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_matter_judgments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_judgments_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_judgments_judgment_id_fkey"
            columns: ["judgment_id"]
            isOneToOne: false
            referencedRelation: "judgments"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_matter_parties: {
        Row: {
          attorney_name: string | null
          contact_info: string | null
          created_at: string
          created_by: string
          docket_matter_id: string
          full_name: string
          id: string
          identification_photo_path: string | null
          last_updated_by: string | null
          party_status: string
          party_type: string
          role: string
          updated_at: string
        }
        Insert: {
          attorney_name?: string | null
          contact_info?: string | null
          created_at?: string
          created_by?: string
          docket_matter_id: string
          full_name: string
          id?: string
          identification_photo_path?: string | null
          last_updated_by?: string | null
          party_status?: string
          party_type?: string
          role: string
          updated_at?: string
        }
        Update: {
          attorney_name?: string | null
          contact_info?: string | null
          created_at?: string
          created_by?: string
          docket_matter_id?: string
          full_name?: string
          id?: string
          identification_photo_path?: string | null
          last_updated_by?: string | null
          party_status?: string
          party_type?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_matter_parties_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_parties_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_parties_last_updated_by_fkey"
            columns: ["last_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_matter_tags: {
        Row: {
          created_at: string
          created_by: string
          docket_matter_id: string
          id: string
          tag_name: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          docket_matter_id: string
          id?: string
          tag_name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          docket_matter_id?: string
          id?: string
          tag_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_matter_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matter_tags_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
        ]
      }
      docket_matters: {
        Row: {
          appeal_status: string
          arraignment_status: string
          case_number: string
          category_id: string | null
          category_other: string | null
          charge_or_issue: string | null
          court_id: string
          cover_image_path: string | null
          created_at: string
          created_by: string
          custody_status: string
          deleted_at: string | null
          deleted_by: string | null
          disclosure_status: string
          district_id: string
          id: string
          judgment_status: string
          last_updated_by: string | null
          matter_title: string
          orders_summary: string | null
          outcome: string | null
          procedure_stage: string | null
          ruling_status: string
          search_vector: unknown
          sentence_status: string
          status: Database["public"]["Enums"]["docket_matter_status"]
          trial_status: string
          updated_at: string
        }
        Insert: {
          appeal_status?: string
          arraignment_status?: string
          case_number: string
          category_id?: string | null
          category_other?: string | null
          charge_or_issue?: string | null
          court_id: string
          cover_image_path?: string | null
          created_at?: string
          created_by?: string
          custody_status?: string
          deleted_at?: string | null
          deleted_by?: string | null
          disclosure_status?: string
          district_id: string
          id?: string
          judgment_status?: string
          last_updated_by?: string | null
          matter_title: string
          orders_summary?: string | null
          outcome?: string | null
          procedure_stage?: string | null
          ruling_status?: string
          search_vector?: unknown
          sentence_status?: string
          status?: Database["public"]["Enums"]["docket_matter_status"]
          trial_status?: string
          updated_at?: string
        }
        Update: {
          appeal_status?: string
          arraignment_status?: string
          case_number?: string
          category_id?: string | null
          category_other?: string | null
          charge_or_issue?: string | null
          court_id?: string
          cover_image_path?: string | null
          created_at?: string
          created_by?: string
          custody_status?: string
          deleted_at?: string | null
          deleted_by?: string | null
          disclosure_status?: string
          district_id?: string
          id?: string
          judgment_status?: string
          last_updated_by?: string | null
          matter_title?: string
          orders_summary?: string | null
          outcome?: string | null
          procedure_stage?: string | null
          ruling_status?: string
          search_vector?: unknown
          sentence_status?: string
          status?: Database["public"]["Enums"]["docket_matter_status"]
          trial_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "docket_matters_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "docket_matter_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matters_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matters_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matters_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "magisterial_districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docket_matters_last_updated_by_fkey"
            columns: ["last_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          file_name: string
          file_path: string
          file_size: number
          id: string
          mime_type: string
          purpose: string
          source_document_id: string | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          file_name: string
          file_path: string
          file_size: number
          id?: string
          mime_type: string
          purpose?: string
          source_document_id?: string | null
          uploaded_by: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          mime_type?: string
          purpose?: string
          source_document_id?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          court_ids: string[]
          description: string | null
          enabled: boolean
          key: string
          roles: string[]
          rollout_percentage: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          court_ids?: string[]
          description?: string | null
          enabled?: boolean
          key: string
          roles?: string[]
          rollout_percentage?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          court_ids?: string[]
          description?: string | null
          enabled?: boolean
          key?: string
          roles?: string[]
          rollout_percentage?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          content_type: string
          created_at: string
          created_by: string | null
          expected_file_count: number | null
          id: string
          label: string
        }
        Insert: {
          content_type: string
          created_at?: string
          created_by?: string | null
          expected_file_count?: number | null
          id?: string
          label: string
        }
        Update: {
          content_type?: string
          created_at?: string
          created_by?: string | null
          expected_file_count?: number | null
          id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          batch_id: string | null
          completed_at: string | null
          content_type: string
          created_at: string
          created_by: string
          duplicate_warning: string | null
          error_summary: string | null
          extracted_metadata: Json | null
          extracted_text: string | null
          id: string
          proposed_tags: string[] | null
          retry_count: number
          source_id: string | null
          source_url: string | null
          started_at: string | null
          status: string
          target_case_law_id: string | null
          target_statute_id: string | null
          updated_at: string
          uploaded_document_id: string | null
        }
        Insert: {
          batch_id?: string | null
          completed_at?: string | null
          content_type: string
          created_at?: string
          created_by: string
          duplicate_warning?: string | null
          error_summary?: string | null
          extracted_metadata?: Json | null
          extracted_text?: string | null
          id?: string
          proposed_tags?: string[] | null
          retry_count?: number
          source_id?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: string
          target_case_law_id?: string | null
          target_statute_id?: string | null
          updated_at?: string
          uploaded_document_id?: string | null
        }
        Update: {
          batch_id?: string | null
          completed_at?: string | null
          content_type?: string
          created_at?: string
          created_by?: string
          duplicate_warning?: string | null
          error_summary?: string | null
          extracted_metadata?: Json | null
          extracted_text?: string | null
          id?: string
          proposed_tags?: string[] | null
          retry_count?: number
          source_id?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: string
          target_case_law_id?: string | null
          target_statute_id?: string | null
          updated_at?: string
          uploaded_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_target_case_law_id_fkey"
            columns: ["target_case_law_id"]
            isOneToOne: false
            referencedRelation: "case_law"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_target_statute_id_fkey"
            columns: ["target_statute_id"]
            isOneToOne: false
            referencedRelation: "statutes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_uploaded_document_id_fkey"
            columns: ["uploaded_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_reports: {
        Row: {
          admin_notes: string | null
          app_version: string | null
          created_at: string
          description: string
          id: string
          page_path: string | null
          reporter_id: string
          reporter_role: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          title: string
          type: string
        }
        Insert: {
          admin_notes?: string | null
          app_version?: string | null
          created_at?: string
          description: string
          id?: string
          page_path?: string | null
          reporter_id: string
          reporter_role?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title: string
          type: string
        }
        Update: {
          admin_notes?: string | null
          app_version?: string | null
          created_at?: string
          description?: string
          id?: string
          page_path?: string | null
          reporter_id?: string
          reporter_role?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      judgment_tags: {
        Row: {
          created_at: string
          created_by: string
          id: string
          judgment_id: string
          tag_name: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          judgment_id: string
          tag_name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          judgment_id?: string
          tag_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "judgment_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judgment_tags_judgment_id_fkey"
            columns: ["judgment_id"]
            isOneToOne: false
            referencedRelation: "judgments"
            referencedColumns: ["id"]
          },
        ]
      }
      judgments: {
        Row: {
          case_number: string | null
          category_id: string | null
          citation: string | null
          content: Json | null
          content_text: string | null
          court_name: string | null
          created_at: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          is_discoverable: boolean
          judgment_date: string | null
          owner_id: string
          search_vector: unknown
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          case_number?: string | null
          category_id?: string | null
          citation?: string | null
          content?: Json | null
          content_text?: string | null
          court_name?: string | null
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          is_discoverable?: boolean
          judgment_date?: string | null
          owner_id?: string
          search_vector?: unknown
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          case_number?: string | null
          category_id?: string | null
          citation?: string | null
          content?: Json | null
          content_text?: string | null
          court_name?: string | null
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          is_discoverable?: boolean
          judgment_date?: string | null
          owner_id?: string
          search_vector?: unknown
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judgments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "legal_case_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judgments_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judgments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      judgment_versions: {
        Row: {
          case_number: string | null
          citation: string | null
          content: Json | null
          content_text: string | null
          court_name: string | null
          created_at: string
          created_by: string | null
          id: string
          judgment_date: string | null
          judgment_id: string
          title: string
          version_number: number
        }
        Insert: {
          case_number?: string | null
          citation?: string | null
          content?: Json | null
          content_text?: string | null
          court_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          judgment_date?: string | null
          judgment_id: string
          title: string
          version_number: number
        }
        Update: {
          case_number?: string | null
          citation?: string | null
          content?: Json | null
          content_text?: string | null
          court_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          judgment_date?: string | null
          judgment_id?: string
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "judgment_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judgment_versions_judgment_id_fkey"
            columns: ["judgment_id"]
            isOneToOne: false
            referencedRelation: "judgments"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_authority_courts: {
        Row: {
          aliases: string[]
          canonical_name: string
          court_level: string | null
          created_at: string
          id: string
          is_active: boolean
          jurisdiction_id: string | null
          regional_group_id: string | null
          short_name: string | null
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          court_level?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          jurisdiction_id?: string | null
          regional_group_id?: string | null
          short_name?: string | null
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          court_level?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          jurisdiction_id?: string | null
          regional_group_id?: string | null
          short_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_authority_courts_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "legal_jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_authority_courts_regional_group_id_fkey"
            columns: ["regional_group_id"]
            isOneToOne: false
            referencedRelation: "legal_regional_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_case_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      legal_jurisdictions: {
        Row: {
          created_at: string
          id: string
          name: string
          regional_group_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          regional_group_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          regional_group_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_jurisdictions_regional_group_id_fkey"
            columns: ["regional_group_id"]
            isOneToOne: false
            referencedRelation: "legal_regional_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_regional_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      legal_sources: {
        Row: {
          base_url: string | null
          canonical_trusted: boolean
          connector_type: string
          created_at: string
          created_by: string | null
          id: string
          jurisdiction: string
          last_checked_at: string | null
          last_successful_import_at: string | null
          name: string
          notes: string | null
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          canonical_trusted?: boolean
          connector_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          jurisdiction: string
          last_checked_at?: string | null
          last_successful_import_at?: string | null
          name: string
          notes?: string | null
          source_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          canonical_trusted?: boolean
          connector_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          jurisdiction?: string
          last_checked_at?: string | null
          last_successful_import_at?: string | null
          name?: string
          notes?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      magisterial_districts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      magistrate_court_requests: {
        Row: {
          approval_kind: string | null
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_admin_at: string | null
          notified_requester_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_assignment_type: string
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["magistrate_court_request_status"]
          updated_at: string
        }
        Insert: {
          approval_kind?: string | null
          cancelled_at?: string | null
          court_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          note?: string | null
          notified_admin_at?: string | null
          notified_requester_at?: string | null
          profile_id: string
          rejection_reason?: string | null
          requested_assignment_type?: string
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["magistrate_court_request_status"]
          updated_at?: string
        }
        Update: {
          approval_kind?: string | null
          cancelled_at?: string | null
          court_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          note?: string | null
          notified_admin_at?: string | null
          notified_requester_at?: string | null
          profile_id?: string
          rejection_reason?: string | null
          requested_assignment_type?: string
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["magistrate_court_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "magistrate_court_requests_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "magistrate_court_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "magistrate_court_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      magistrate_courts: {
        Row: {
          assignment_type: string
          can_manage_clerks: boolean
          court_id: string
          created_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          profile_id: string
          started_at: string
          updated_at: string
        }
        Insert: {
          assignment_type?: string
          can_manage_clerks?: boolean
          court_id: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          profile_id: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          assignment_type?: string
          can_manage_clerks?: boolean
          court_id?: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          profile_id?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "magistrate_courts_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "magistrate_courts_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "magistrate_courts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          court_id: string | null
          court_name: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          jurisdiction: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          court_id?: string | null
          court_name?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          jurisdiction?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          court_id?: string | null
          court_name?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          jurisdiction?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_code_case_law: {
        Row: {
          case_law_id: string
          created_at: string
          created_by: string
          id: string
          quick_code_id: string
        }
        Insert: {
          case_law_id: string
          created_at?: string
          created_by?: string
          id?: string
          quick_code_id: string
        }
        Update: {
          case_law_id?: string
          created_at?: string
          created_by?: string
          id?: string
          quick_code_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_code_case_law_case_law_id_fkey"
            columns: ["case_law_id"]
            isOneToOne: false
            referencedRelation: "case_law"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_code_case_law_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_code_case_law_quick_code_id_fkey"
            columns: ["quick_code_id"]
            isOneToOne: false
            referencedRelation: "quick_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_code_docket_matters: {
        Row: {
          created_at: string
          created_by: string
          docket_matter_id: string
          id: string
          quick_code_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          docket_matter_id: string
          id?: string
          quick_code_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          docket_matter_id?: string
          id?: string
          quick_code_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_code_docket_matters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_code_docket_matters_docket_matter_id_fkey"
            columns: ["docket_matter_id"]
            isOneToOne: false
            referencedRelation: "docket_matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_code_docket_matters_quick_code_id_fkey"
            columns: ["quick_code_id"]
            isOneToOne: false
            referencedRelation: "quick_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_code_judgments: {
        Row: {
          created_at: string
          created_by: string
          id: string
          judgment_id: string
          quick_code_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          judgment_id: string
          quick_code_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          judgment_id?: string
          quick_code_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_code_judgments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_code_judgments_judgment_id_fkey"
            columns: ["judgment_id"]
            isOneToOne: false
            referencedRelation: "judgments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_code_judgments_quick_code_id_fkey"
            columns: ["quick_code_id"]
            isOneToOne: false
            referencedRelation: "quick_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_codes: {
        Row: {
          category: string | null
          code_word: string
          content: string
          created_at: string
          description: string | null
          id: string
          owner_id: string
          search_vector: unknown
          title: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          code_word: string
          content: string
          created_at?: string
          description?: string | null
          id?: string
          owner_id?: string
          search_vector?: unknown
          title?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          code_word?: string
          content?: string
          created_at?: string
          description?: string | null
          id?: string
          owner_id?: string
          search_vector?: unknown
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_codes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shares: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          item_id: string
          item_type: string
          permission: string
          recipient_id: string | null
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          item_id: string
          item_type: string
          permission: string
          recipient_id?: string | null
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          item_id?: string
          item_type?: string
          permission?: string
          recipient_id?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shares_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shares_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      statute_provisions: {
        Row: {
          body_text: string | null
          created_at: string
          heading: string | null
          id: string
          level: string
          number: string | null
          parent_provision_id: string | null
          search_vector: unknown
          sort_order: number
          statute_id: string
          updated_at: string
        }
        Insert: {
          body_text?: string | null
          created_at?: string
          heading?: string | null
          id?: string
          level: string
          number?: string | null
          parent_provision_id?: string | null
          search_vector?: unknown
          sort_order?: number
          statute_id: string
          updated_at?: string
        }
        Update: {
          body_text?: string | null
          created_at?: string
          heading?: string | null
          id?: string
          level?: string
          number?: string | null
          parent_provision_id?: string | null
          search_vector?: unknown
          sort_order?: number
          statute_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statute_provisions_parent_provision_id_fkey"
            columns: ["parent_provision_id"]
            isOneToOne: false
            referencedRelation: "statute_provisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statute_provisions_statute_id_fkey"
            columns: ["statute_id"]
            isOneToOne: false
            referencedRelation: "statutes"
            referencedColumns: ["id"]
          },
        ]
      }
      statute_tags: {
        Row: {
          created_at: string
          statute_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          statute_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          statute_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "statute_tags_statute_id_fkey"
            columns: ["statute_id"]
            isOneToOne: false
            referencedRelation: "statutes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statute_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      statutes: {
        Row: {
          act_number: string | null
          amendment_note: string | null
          chapter_number: string | null
          code: string
          commencement_note: string | null
          content_quality_status: string
          created_at: string
          created_by: string | null
          document_hash: string | null
          effective_date: string | null
          enactment_year: number | null
          full_text: string | null
          has_text_layer: boolean | null
          id: string
          import_job_id: string | null
          instrument_type: string | null
          is_current_version: boolean
          jurisdiction: string
          jurisdiction_id: string | null
          original_filename: string | null
          page_count: number | null
          primary_document_id: string | null
          retrieved_at: string | null
          review_status: string
          search_vector: unknown
          short_title: string | null
          source_id: string | null
          source_url: string | null
          summary: string | null
          supersedes_statute_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          act_number?: string | null
          amendment_note?: string | null
          chapter_number?: string | null
          code: string
          commencement_note?: string | null
          content_quality_status?: string
          created_at?: string
          created_by?: string | null
          document_hash?: string | null
          effective_date?: string | null
          enactment_year?: number | null
          full_text?: string | null
          has_text_layer?: boolean | null
          id?: string
          import_job_id?: string | null
          instrument_type?: string | null
          is_current_version?: boolean
          jurisdiction: string
          jurisdiction_id?: string | null
          original_filename?: string | null
          page_count?: number | null
          primary_document_id?: string | null
          retrieved_at?: string | null
          review_status?: string
          search_vector?: unknown
          short_title?: string | null
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          supersedes_statute_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          act_number?: string | null
          amendment_note?: string | null
          chapter_number?: string | null
          code?: string
          commencement_note?: string | null
          content_quality_status?: string
          created_at?: string
          created_by?: string | null
          document_hash?: string | null
          effective_date?: string | null
          enactment_year?: number | null
          full_text?: string | null
          has_text_layer?: boolean | null
          id?: string
          import_job_id?: string | null
          instrument_type?: string | null
          is_current_version?: boolean
          jurisdiction?: string
          jurisdiction_id?: string | null
          original_filename?: string | null
          page_count?: number | null
          primary_document_id?: string | null
          retrieved_at?: string | null
          review_status?: string
          search_vector?: unknown
          short_title?: string | null
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          supersedes_statute_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statutes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutes_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutes_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "legal_jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutes_primary_document_id_fkey"
            columns: ["primary_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutes_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutes_supersedes_statute_id_fkey"
            columns: ["supersedes_statute_id"]
            isOneToOne: false
            referencedRelation: "statutes"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          active: boolean
          court_id: string | null
          created_at: string
          created_by: string | null
          events: string[]
          id: string
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          court_id?: string | null
          created_by?: string | null
          events?: string[]
          id?: string
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          court_id?: string | null
          created_by?: string | null
          events?: string[]
          id?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      webhook_outbox: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event: string
          id: string
          last_error: string | null
          payload: Json
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event: string
          id?: string
          last_error?: string | null
          payload: Json
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event?: string
          id?: string
          last_error?: string | null
          payload?: Json
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_assign_magistrate_court: {
        Args: {
          p_assignment_type?: string
          p_court_id: string
          p_profile_id: string
        }
        Returns: {
          assignment_type: string
          can_manage_clerks: boolean
          court_id: string
          created_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          profile_id: string
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "magistrate_courts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_bootstrap_self_approve_magistrate_court_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: {
          approval_kind: string | null
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_admin_at: string | null
          notified_requester_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_assignment_type: string
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["magistrate_court_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "magistrate_court_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_case_law_tags: {
        Args: { p_case_law_id: string; p_tag_names: string[] }
        Returns: undefined
      }
      apply_statute_tags: {
        Args: { p_statute_id: string; p_tag_names: string[] }
        Returns: undefined
      }
      bin_docket_matter: {
        Args: { p_id: string }
        Returns: {
          appeal_status: string
          arraignment_status: string
          case_number: string
          category_id: string | null
          category_other: string | null
          charge_or_issue: string | null
          court_id: string
          cover_image_path: string | null
          created_at: string
          created_by: string
          custody_status: string
          deleted_at: string | null
          deleted_by: string | null
          disclosure_status: string
          district_id: string
          id: string
          judgment_status: string
          last_updated_by: string | null
          matter_title: string
          orders_summary: string | null
          outcome: string | null
          procedure_stage: string | null
          ruling_status: string
          search_vector: unknown
          sentence_status: string
          status: Database["public"]["Enums"]["docket_matter_status"]
          trial_status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "docket_matters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      download_my_data: { Args: never; Returns: Json }
      verify_audit_hash_chain: {
        Args: never
        Returns: {
          broken_id: number | null
          ok: boolean
        }[]
      }
      can_access_court: { Args: { p_court_id: string }; Returns: boolean }
      can_attach_preview_derivative: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_source_document_id: string
        }
        Returns: boolean
      }
      can_edit_case_law: { Args: { p_case_law_id: string }; Returns: boolean }
      can_edit_docket_matter: {
        Args: { p_docket_matter_id: string }
        Returns: boolean
      }
      can_edit_judgment: { Args: { p_judgment_id: string }; Returns: boolean }
      can_manage_clerk_access: {
        Args: { p_court_id: string }
        Returns: boolean
      }
      can_view_case_law: { Args: { p_case_law_id: string }; Returns: boolean }
      can_view_docket_matter: {
        Args: { p_docket_matter_id: string }
        Returns: boolean
      }
      can_view_judgment: { Args: { p_judgment_id: string }; Returns: boolean }
      can_view_statute: { Args: { p_statute_id: string }; Returns: boolean }
      cancel_clerk_access_request: {
        Args: { p_request_id: string }
        Returns: {
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_clerk_at: string | null
          notified_magistrate_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["clerk_access_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clerk_access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_magistrate_court_request: {
        Args: { p_request_id: string }
        Returns: {
          approval_kind: string | null
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_admin_at: string | null
          notified_requester_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_assignment_type: string
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["magistrate_court_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "magistrate_court_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      case_law_counts_by_category: {
        Args: {
          p_court_id?: string
          p_jurisdiction_id?: string
          p_query?: string
          p_tag_id?: string
        }
        Returns: {
          category_id: string
          result_count: number
        }[]
      }
      case_law_counts_by_court: {
        Args: {
          p_category_id?: string
          p_jurisdiction_id?: string
          p_query?: string
          p_tag_id?: string
        }
        Returns: {
          court_id: string
          result_count: number
        }[]
      }
      case_law_counts_by_jurisdiction: {
        Args: {
          p_category_id?: string
          p_court_id?: string
          p_query?: string
          p_tag_id?: string
        }
        Returns: {
          jurisdiction_id: string
          result_count: number
        }[]
      }
      case_law_matches_query: {
        Args: {
          p_case_name: string
          p_citation: string
          p_query: string
          p_search_vector: unknown
        }
        Returns: boolean
      }
      case_law_search_rank: {
        Args: { p_case_name: string; p_query: string; p_search_vector: unknown }
        Returns: number
      }
      clerk_access_request_email_confirmed: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      clerk_profiles_for_review: {
        Args: { p_profile_ids: string[] }
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      court_has_active_primary_magistrate: {
        Args: { p_court_id: string }
        Returns: boolean
      }
      court_has_no_clerk_approver: {
        Args: { p_court_id: string }
        Returns: boolean
      }
      create_case_law_import: {
        Args: {
          p_batch_id?: string
          p_case_name: string
          p_category_id?: string
          p_citation: string
          p_content_quality_status?: string
          p_court: string
          p_court_id?: string
          p_decided_date?: string
          p_document_hash?: string
          p_duplicate_warning?: string
          p_extracted_metadata?: Json
          p_full_text?: string
          p_jurisdiction: string
          p_jurisdiction_id?: string
          p_neutral_citation?: string
          p_original_filename?: string
          p_proposed_tags?: string[]
          p_reported_citation?: string
          p_source_id?: string
          p_source_url?: string
        }
        Returns: {
          case_law_id: string
          import_job_id: string
        }[]
      }
      create_legislation_import: {
        Args: {
          p_act_number?: string
          p_batch_id?: string
          p_chapter_number?: string
          p_code: string
          p_content_quality_status?: string
          p_document_hash?: string
          p_duplicate_warning?: string
          p_effective_date?: string
          p_enactment_year?: number
          p_extracted_metadata?: Json
          p_full_text?: string
          p_instrument_type?: string
          p_jurisdiction: string
          p_jurisdiction_id?: string
          p_original_filename?: string
          p_proposed_tags?: string[]
          p_provisions?: Json
          p_short_title?: string
          p_source_id?: string
          p_source_url?: string
          p_title: string
        }
        Returns: {
          import_job_id: string
          provision_count: number
          statute_id: string
        }[]
      }
      decide_clerk_access_request: {
        Args: {
          p_decision: Database["public"]["Enums"]["clerk_access_decision"]
          p_rejection_reason?: string
          p_request_id: string
        }
        Returns: {
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_clerk_at: string | null
          notified_magistrate_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["clerk_access_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clerk_access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_magistrate_court_request: {
        Args: {
          p_decision: Database["public"]["Enums"]["magistrate_court_decision"]
          p_rejection_reason?: string
          p_request_id: string
        }
        Returns: {
          approval_kind: string | null
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_admin_at: string | null
          notified_requester_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_assignment_type: string
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["magistrate_court_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "magistrate_court_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_legislation_document: {
        Args: {
          p_document_id: string
          p_has_text_layer?: boolean
          p_page_count?: number
          p_statute_id: string
        }
        Returns: undefined
      }
      find_next_available_docket_date: {
        Args: {
          p_category_id: string
          p_max_days_ahead?: number
          p_start_date: string
        }
        Returns: string
      }
      format_case_law_title: { Args: { p_input: string }; Returns: string }
      format_case_law_title_atom: {
        Args: { p_force_cap: boolean; p_word: string }
        Returns: string
      }
      format_case_law_title_word: {
        Args: { p_force_cap: boolean; p_word: string }
        Returns: string
      }
      get_daily_docket_report_data: {
        Args: { p_court_id?: string; p_date: string }
        Returns: {
          appearance_stage: string
          appearance_status: string
          case_number: string
          category_id: string
          category_name: string
          charge_or_issue: string
          court_name: string
          custody_status: string
          district_name: string
          matter_id: string
          matter_title: string
          next_appearance: string
          notes: string
          orders_summary: string
          outcome: string
          outcome_at_event: string
          parties: Json
          procedure_stage: string
          status: Database["public"]["Enums"]["docket_matter_status"]
          witnesses_called: number
          witnesses_completed: number
          witnesses_partly_heard: number
          witnesses_remaining: number
        }[]
      }
      get_docket_capacity_snapshot: {
        Args: { p_category_id?: string; p_scheduled_date: string }
        Returns: {
          category_id: string
          category_name: string
          daily_capacity: number
          scheduled_count: number
          status: string
        }[]
      }
      global_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: Database["public"]["CompositeTypes"]["search_result"][]
        SetofOptions: {
          from: "*"
          to: "search_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_active_clerk_assignment: {
        Args: { p_court_id: string }
        Returns: boolean
      }
      has_active_magistrate_court: { Args: never; Returns: boolean }
      has_docket_matter_authority: {
        Args: { p_docket_matter_id: string }
        Returns: boolean
      }
      has_docket_share: {
        Args: { p_docket_matter_id: string; p_required_permission?: string }
        Returns: boolean
      }
      has_retained_assignment: {
        Args: { p_docket_matter_id: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_clerk: { Args: never; Returns: boolean }
      is_magistrate: { Args: never; Returns: boolean }
      is_sole_admin_bootstrap_available: { Args: never; Returns: boolean }
      list_active_courts_for_magistrate_signup: {
        Args: never
        Returns: {
          district_id: string
          id: string
          is_assigned: boolean
          name: string
        }[]
      }
      list_active_courts_for_signup: {
        Args: never
        Returns: {
          district_id: string
          id: string
          name: string
        }[]
      }
      list_active_magisterial_districts_for_signup: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      list_binned_docket_matters: {
        Args: never
        Returns: {
          case_number: string
          court_id: string
          court_name: string
          deleted_at: string
          deleted_by: string
          id: string
          matter_title: string
          status: Database["public"]["Enums"]["docket_matter_status"]
          updated_at: string
        }[]
      }
      list_clerk_access_requests_needing_admin_attention: {
        Args: never
        Returns: {
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_clerk_at: string | null
          notified_magistrate_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["clerk_access_request_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "clerk_access_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_courts_for_magistrate_request: {
        Args: never
        Returns: {
          district_id: string
          id: string
          name: string
          status: string
        }[]
      }
      list_docket_matters: {
        Args: {
          p_court_id?: string
          p_custody?: string[]
          p_disclosure?: string[]
          p_exact_date?: string
          p_limit?: number
          p_next_date?: string[]
          p_procedure_stages?: string[]
          p_query?: string
          p_trial?: string[]
        }
        Returns: {
          appeal_status: string
          appearance_outcome: string
          appearance_stage: string
          appearance_status: string
          arraignment_status: string
          can_edit: boolean
          case_number: string
          category_id: string
          category_name: string
          category_other: string
          charge_or_issue: string
          court_id: string
          court_name: string
          cover_image_path: string
          created_at: string
          custody_status: string
          disclosure_status: string
          district_id: string
          has_judgment_document: boolean
          has_ruling_document: boolean
          headline: string
          id: string
          judgment_status: string
          matter_title: string
          next_appearance: string
          procedure_stage: string
          rank: number
          ruling_status: string
          sentence_status: string
          status: Database["public"]["Enums"]["docket_matter_status"]
          trial_status: string
          updated_at: string
        }[]
      }
      list_magistrate_court_request_email_confirmation: {
        Args: never
        Returns: {
          email_confirmed: boolean
          request_id: string
        }[]
      }
      magistrate_court_request_email_confirmed: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      matter_current_stage_label: {
        Args: { p_docket_matter_id: string }
        Returns: string
      }
      my_court_id: { Args: never; Returns: string }
      publish_case_law_import: {
        Args: { p_case_law_id: string }
        Returns: undefined
      }
      publish_legislation_import: {
        Args: { p_statute_id: string }
        Returns: undefined
      }
      purge_docket_matter: { Args: { p_id: string }; Returns: undefined }
      purge_docket_matter_row: { Args: { p_id: string }; Returns: undefined }
      purge_expired_docket_matters: { Args: never; Returns: number }
      record_auth_event: {
        Args: { p_email: string; p_event: string; p_user_agent: string }
        Returns: undefined
      }
      reject_case_law_import: {
        Args: { p_case_law_id: string; p_reason?: string }
        Returns: undefined
      }
      reject_legislation_import: {
        Args: { p_reason?: string; p_statute_id: string }
        Returns: undefined
      }
      relinquish_magistrate_court: {
        Args: { p_assignment_id: string; p_reason?: string }
        Returns: {
          assignment_type: string
          can_manage_clerks: boolean
          court_id: string
          created_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          profile_id: string
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "magistrate_courts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_docket_assignment_identity: {
        Args: { p_assignment_id: string }
        Returns: {
          display_name: string
          profile_id: string
        }[]
      }
      resolve_docket_share_identity: {
        Args: { p_share_id: string }
        Returns: {
          granted_by: string
          grantor_display_name: string
          recipient_display_name: string
          recipient_id: string
        }[]
      }
      resolve_docket_share_recipient: {
        Args: { p_docket_matter_id: string; p_email: string }
        Returns: {
          display_name: string
          profile_id: string
        }[]
      }
      resolve_item_share_recipient: {
        Args: { p_email: string; p_item_id: string; p_item_type: string }
        Returns: {
          display_name: string
          profile_id: string
        }[]
      }
      restore_docket_matter: {
        Args: { p_id: string }
        Returns: {
          appeal_status: string
          arraignment_status: string
          case_number: string
          category_id: string | null
          category_other: string | null
          charge_or_issue: string | null
          court_id: string
          cover_image_path: string | null
          created_at: string
          created_by: string
          custody_status: string
          deleted_at: string | null
          deleted_by: string | null
          disclosure_status: string
          district_id: string
          id: string
          judgment_status: string
          last_updated_by: string | null
          matter_title: string
          orders_summary: string | null
          outcome: string | null
          procedure_stage: string | null
          ruling_status: string
          search_vector: unknown
          sentence_status: string
          status: Database["public"]["Enums"]["docket_matter_status"]
          trial_status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "docket_matters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_clerk_court_access: {
        Args: { p_assignment_id: string; p_reason?: string }
        Returns: {
          approved_by: string
          court_id: string
          created_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          profile_id: string
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clerk_courts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      schedule_docket_event_with_capacity: {
        Args: {
          p_acknowledge_override?: boolean
          p_category_id?: string
          p_docket_matter_id: string
          p_event_id?: string
          p_event_status?: string
          p_event_type?: string
          p_location?: string
          p_notes?: string
          p_orders_made_at_event?: string
          p_outcome_at_event?: string
          p_override_reason?: string
          p_scheduled_date: string
          p_scheduled_time?: string
          p_stage_at_event?: string
        }
        Returns: {
          category_id: string
          category_name: string
          configured_capacity: number
          event_id: string
          is_over_capacity: boolean
          scheduled_count: number
          status: string
        }[]
      }
      search_bench_notes: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          entity_id: string
          entity_type: string
          headline: string
          id: string
          rank: number
          title: string
        }[]
      }
      search_case_law: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          case_name: string
          citation: string
          court: string
          headline: string
          id: string
          jurisdiction: string
          rank: number
          summary: string
        }[]
      }
      search_case_law_scoped: {
        Args: {
          p_category_id?: string
          p_court_id?: string
          p_jurisdiction_id?: string
          p_limit?: number
          p_query?: string
          p_tag_id?: string
        }
        Returns: {
          case_name: string
          citation: string
          court: string
          headline: string
          id: string
          jurisdiction: string
          rank: number
          summary: string
        }[]
      }
      search_cases: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          case_number: string
          headline: string
          id: string
          rank: number
          status: Database["public"]["Enums"]["case_status"]
          title: string
        }[]
      }
      search_docket_matters: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          appeal_status: string
          arraignment_status: string
          case_number: string
          charge_or_issue: string
          cover_image_path: string
          custody_status: string
          disclosure_status: string
          headline: string
          id: string
          judgment_status: string
          matter_title: string
          procedure_stage: string
          rank: number
          ruling_status: string
          sentence_status: string
          status: Database["public"]["Enums"]["docket_matter_status"]
          trial_status: string
        }[]
      }
      search_judgments: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          case_number: string
          citation: string
          headline: string
          id: string
          rank: number
          status: string
          title: string
        }[]
      }
      search_quick_codes: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          code_word: string
          headline: string
          id: string
          rank: number
          title: string
        }[]
      }
      search_statutes: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          code: string
          headline: string
          id: string
          jurisdiction: string
          rank: number
          summary: string
          title: string
        }[]
      }
      set_case_law_review_status: {
        Args: { p_case_law_id: string; p_status: string }
        Returns: undefined
      }
      set_docket_matter_next_date: {
        Args: {
          p_acknowledge_override?: boolean
          p_category_id?: string
          p_docket_matter_id: string
          p_override_reason?: string
          p_scheduled_date: string
        }
        Returns: {
          category_id: string
          category_name: string
          configured_capacity: number
          event_id: string
          is_over_capacity: boolean
          scheduled_count: number
          status: string
        }[]
      }
      set_legislation_review_status: {
        Args: { p_status: string; p_statute_id: string }
        Returns: undefined
      }
      submit_clerk_access_request: {
        Args: { p_court_id: string; p_note?: string; p_staff_id?: string }
        Returns: {
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_clerk_at: string | null
          notified_magistrate_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["clerk_access_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clerk_access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_magistrate_court_request: {
        Args: { p_court_id: string; p_note?: string; p_staff_id?: string }
        Returns: {
          approval_kind: string | null
          cancelled_at: string | null
          court_id: string
          created_at: string
          expires_at: string | null
          id: string
          note: string | null
          notified_admin_at: string | null
          notified_requester_at: string | null
          profile_id: string
          rejection_reason: string | null
          requested_assignment_type: string
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["magistrate_court_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "magistrate_court_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_can_access_bench_note: {
        Args: { p_note_id: string }
        Returns: boolean
      }
      user_can_access_case: { Args: { p_case_id: string }; Returns: boolean }
    }
    Enums: {
      audit_action: "insert" | "update" | "delete"
      auth_event_type:
        | "login_success"
        | "login_failed"
        | "logout"
        | "password_reset_requested"
      bookmark_entity_type:
        | "case"
        | "bench_note"
        | "statute"
        | "case_law"
        | "docket_matter"
        | "judgment"
        | "quick_code"
        | "statute_provision"
      case_status: "open" | "pending" | "closed" | "archived"
      clerk_access_decision: "approved" | "rejected"
      clerk_access_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "expired"
      docket_matter_status: "active" | "stayed" | "completed" | "archived"
      magistrate_court_decision: "approved" | "rejected"
      magistrate_court_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "expired"
      note_status: "draft" | "published"
      party_role:
        | "plaintiff"
        | "defendant"
        | "petitioner"
        | "respondent"
        | "appellant"
        | "appellee"
        | "witness"
        | "other"
      user_role: "magistrate" | "clerk" | "admin"
    }
    CompositeTypes: {
      search_result: {
        entity_type: string | null
        id: string | null
        title: string | null
        subtitle: string | null
        headline: string | null
        rank: number | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_action: ["insert", "update", "delete"],
      auth_event_type: [
        "login_success",
        "login_failed",
        "logout",
        "password_reset_requested",
      ],
      bookmark_entity_type: [
        "case",
        "bench_note",
        "statute",
        "case_law",
        "docket_matter",
        "judgment",
        "quick_code",
        "statute_provision",
      ],
      case_status: ["open", "pending", "closed", "archived"],
      clerk_access_decision: ["approved", "rejected"],
      clerk_access_request_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ],
      docket_matter_status: ["active", "stayed", "completed", "archived"],
      magistrate_court_decision: ["approved", "rejected"],
      magistrate_court_request_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ],
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
} as const

export type Profile = Tables<"profiles">;
export type Court = Tables<"courts">;
export type MagisterialDistrict = Tables<"magisterial_districts">;
export type MagistrateCourt = Tables<"magistrate_courts">;
export type Case = Tables<"cases">;
export type CaseParty = Tables<"case_parties">;
export type BenchNote = Tables<"bench_notes">;
export type Statute = Tables<"statutes">;
export type StatuteProvision = Tables<"statute_provisions">;
export type LegalSource = Tables<"legal_sources">;
export type LegalRegionalGroup = Tables<"legal_regional_groups">;
export type LegalJurisdiction = Tables<"legal_jurisdictions">;
export type LegalAuthorityCourt = Tables<"legal_authority_courts">;
export type LegalCaseCategory = Tables<"legal_case_categories">;
export type ImportBatch = Tables<"import_batches">;
export type ImportJob = Tables<"import_jobs">;
export type CaseLaw = Tables<"case_law">;
export type CaseLawAnnotation = Tables<"case_law_annotations">;
export type Tag = Tables<"tags">;
export type Document = Tables<"documents">;
export type Comment = Tables<"comments">;
export type Bookmark = Tables<"bookmarks">;
export type AuditLogEntry = Tables<"audit_log">;
export type AuthEventLogEntry = Tables<"auth_event_log">;
export type SearchResult = CompositeTypes<"search_result">;

export type DocketMatter = Tables<"docket_matters">;
export type DocketEvent = Tables<"docket_events">;
export type DocketEventCalendarLink = Tables<"docket_event_calendar_links">;
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

export type DocketMatterCategory = Tables<"docket_matter_categories">;
export type DocketCapacitySetting = Tables<"docket_capacity_settings">;
export type DocketCapacityOverride = Tables<"docket_capacity_overrides">;

export type ClerkCourt = Tables<"clerk_courts">;
export type ClerkAccessRequest = Tables<"clerk_access_requests">;
