/**
 * Generated directly from the live Supabase project (gipijpeahkznfwitjccy)
 * via `mcp__supabase__generate_typescript_types` after applying
 * `supabase/migrations/0001_init.sql` through
 * `0012_performance_and_security_hardening.sql`.
 *
 * To refresh after future schema changes:
 *   npm run supabase:types
 * (requires `supabase link` and SUPABASE_PROJECT_ID — see supabase/README.md)
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
      bench_notes: {
        Row: {
          author_id: string;
          case_id: string | null;
          content: Json;
          content_text: string;
          created_at: string;
          id: string;
          is_private: boolean;
          search_vector: unknown;
          status: Database["public"]["Enums"]["note_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          case_id?: string | null;
          content?: Json;
          content_text?: string;
          created_at?: string;
          id?: string;
          is_private?: boolean;
          search_vector?: unknown;
          status?: Database["public"]["Enums"]["note_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          case_id?: string | null;
          content?: Json;
          content_text?: string;
          created_at?: string;
          id?: string;
          is_private?: boolean;
          search_vector?: unknown;
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
          {
            foreignKeyName: "bench_notes_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
        ];
      };
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
          jurisdiction: string;
          search_vector: unknown;
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
          jurisdiction: string;
          search_vector?: unknown;
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
          jurisdiction?: string;
          search_vector?: unknown;
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
          search_vector: unknown;
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
          search_vector?: unknown;
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
          search_vector?: unknown;
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
          id: string;
          jurisdiction: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          id?: string;
          jurisdiction: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          id?: string;
          jurisdiction?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          bench_note_id: string | null;
          case_id: string | null;
          created_at: string;
          file_name: string;
          file_path: string;
          file_size: number;
          id: string;
          mime_type: string;
          uploaded_by: string;
        };
        Insert: {
          bench_note_id?: string | null;
          case_id?: string | null;
          created_at?: string;
          file_name: string;
          file_path: string;
          file_size: number;
          id?: string;
          mime_type: string;
          uploaded_by: string;
        };
        Update: {
          bench_note_id?: string | null;
          case_id?: string | null;
          created_at?: string;
          file_name?: string;
          file_path?: string;
          file_size?: number;
          id?: string;
          mime_type?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_bench_note_id_fkey";
            columns: ["bench_note_id"];
            isOneToOne: false;
            referencedRelation: "bench_notes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
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
          search_vector: unknown;
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
          search_vector?: unknown;
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
          search_vector?: unknown;
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
      global_search: {
        Args: { p_limit?: number; p_query: string };
        Returns: Database["public"]["CompositeTypes"]["search_result"][];
      };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      my_court_id: { Args: Record<string, never>; Returns: string };
      search_bench_notes: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          case_id: string;
          headline: string;
          id: string;
          rank: number;
          title: string;
        }[];
      };
      search_case_law: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          case_name: string;
          citation: string;
          court: string;
          headline: string;
          id: string;
          jurisdiction: string;
          rank: number;
          summary: string;
        }[];
      };
      search_cases: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          case_number: string;
          headline: string;
          id: string;
          rank: number;
          status: Database["public"]["Enums"]["case_status"];
          title: string;
        }[];
      };
      search_statutes: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          code: string;
          headline: string;
          id: string;
          jurisdiction: string;
          rank: number;
          summary: string;
          title: string;
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
      bookmark_entity_type: "case" | "bench_note" | "statute" | "case_law";
      case_status: "open" | "pending" | "closed" | "archived";
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
      bookmark_entity_type: ["case", "bench_note", "statute", "case_law"],
      case_status: ["open", "pending", "closed", "archived"],
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
export type Case = Tables<"cases">;
export type CaseParty = Tables<"case_parties">;
export type BenchNote = Tables<"bench_notes">;
export type Statute = Tables<"statutes">;
export type CaseLaw = Tables<"case_law">;
export type Tag = Tables<"tags">;
export type Document = Tables<"documents">;
export type Comment = Tables<"comments">;
export type Bookmark = Tables<"bookmarks">;
export type AuditLogEntry = Tables<"audit_log">;
export type SearchResult = CompositeTypes<"search_result">;
