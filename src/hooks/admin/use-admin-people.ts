import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  INSTITUTIONAL_AUDIT_TABLES,
  summarizeAuthEvent,
  summarizeChange,
  type AuditAction,
  type AuthEventType,
} from "@/lib/audit-activity";
import type { UserRole } from "@/lib/constants";
import type { Json } from "@/types/database.types";

const LOGIN_LOOKBACK = 3000;
const ACTIVITY_LOOKBACK = 1500;

export const adminPeopleKeys = {
  all: ["admin", "people"] as const,
};

export interface AdminPersonCourt {
  courtId: string;
  courtName: string;
  kind: "magistrate" | "clerk";
  assignmentType?: string;
}

export interface AdminPersonRow {
  id: string;
  fullName: string | null;
  email: string;
  role: UserRole;
  isActive: boolean;
  courts: AdminPersonCourt[];
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  lastActivityLabel: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
  is_active: boolean;
}

interface CourtJoin {
  id: string;
  name: string;
}

function asCourtJoin(value: unknown): CourtJoin | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const rec = row as { id?: unknown; name?: unknown };
  if (typeof rec.id !== "string" || typeof rec.name !== "string") return null;
  return { id: rec.id, name: rec.name };
}

interface MagistrateAssignmentRow {
  profile_id: string;
  court_id: string;
  assignment_type: string;
  courts: CourtJoin | null;
}

interface ClerkAssignmentRow {
  profile_id: string;
  court_id: string;
  courts: CourtJoin | null;
}

export interface LoginEventRow {
  actor_id: string | null;
  email: string | null;
  created_at: string;
}

export interface ActivityEventRow {
  actorId: string | null;
  createdAt: string;
  label: string;
}

const laterEvent = (
  a: { at: string; label: string } | undefined,
  b: { at: string; label: string } | undefined,
): { at: string; label: string } | undefined => {
  if (!a) return b;
  if (!b) return a;
  return a.at >= b.at ? a : b;
};

/**
 * Fold profile rows, current court sittings, last successful sign-in, and
 * the most recent institutional activity into one directory row per person.
 * Pure so the merge can be unit-tested without Supabase.
 */
export function buildAdminPeopleRows(input: {
  profiles: ProfileRow[];
  magistrateAssignments: MagistrateAssignmentRow[];
  clerkAssignments: ClerkAssignmentRow[];
  loginEvents: LoginEventRow[];
  activityEvents: ActivityEventRow[];
}): AdminPersonRow[] {
  const courtsByProfile = new Map<string, AdminPersonCourt[]>();
  const addCourt = (profileId: string, court: AdminPersonCourt) => {
    const list = courtsByProfile.get(profileId) ?? [];
    if (!list.some((existing) => existing.courtId === court.courtId && existing.kind === court.kind)) {
      list.push(court);
    }
    courtsByProfile.set(profileId, list);
  };

  for (const row of input.magistrateAssignments) {
    addCourt(row.profile_id, {
      courtId: row.court_id,
      courtName: row.courts?.name ?? "Unknown court",
      kind: "magistrate",
      assignmentType: row.assignment_type,
    });
  }
  for (const row of input.clerkAssignments) {
    addCourt(row.profile_id, {
      courtId: row.court_id,
      courtName: row.courts?.name ?? "Unknown court",
      kind: "clerk",
    });
  }

  const lastLoginById = new Map<string, string>();
  const lastLoginByEmail = new Map<string, string>();
  const takeLater = (map: Map<string, string>, key: string, at: string) => {
    const existing = map.get(key);
    if (!existing || at > existing) map.set(key, at);
  };
  for (const event of input.loginEvents) {
    if (event.actor_id) takeLater(lastLoginById, event.actor_id, event.created_at);
    const emailKey = event.email?.trim().toLowerCase();
    if (emailKey) takeLater(lastLoginByEmail, emailKey, event.created_at);
  }

  const lastActivityById = new Map<string, { at: string; label: string }>();
  for (const event of input.activityEvents) {
    if (!event.actorId) continue;
    const existing = lastActivityById.get(event.actorId);
    lastActivityById.set(event.actorId, laterEvent(existing, { at: event.createdAt, label: event.label })!);
  }

  return [...input.profiles]
    .sort((a, b) => {
      const nameA = (a.full_name || a.email).toLowerCase();
      const nameB = (b.full_name || b.email).toLowerCase();
      return nameA.localeCompare(nameB);
    })
    .map((profile) => {
      const lastLoginAt =
        lastLoginById.get(profile.id) ?? lastLoginByEmail.get(profile.email.trim().toLowerCase()) ?? null;
      const activity = lastActivityById.get(profile.id);
      return {
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        role: profile.role,
        isActive: profile.is_active,
        courts: courtsByProfile.get(profile.id) ?? [],
        lastLoginAt,
        lastActivityAt: activity?.at ?? null,
        lastActivityLabel: activity?.label ?? null,
      };
    });
}

/**
 * Admin directory of every profile: current courts, last successful sign-in,
 * and latest institutional activity. Relies on existing admin-only SELECT
 * policies — no new RLS. Mounted only behind ProtectedRoute allowedRoles=["admin"].
 */
export function useAdminPeople() {
  return useQuery({
    queryKey: adminPeopleKeys.all,
    queryFn: async (): Promise<AdminPersonRow[]> => {
      const [profilesResult, magistrateResult, clerkResult, loginResult, authResult, auditResult] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, role, is_active")
            .order("full_name"),
          supabase
            .from("magistrate_courts")
            .select("profile_id, court_id, assignment_type, courts(id, name)")
            .is("ended_at", null),
          supabase
            .from("clerk_courts")
            .select("profile_id, court_id, courts(id, name)")
            .is("ended_at", null),
          supabase
            .from("auth_event_log")
            .select("actor_id, email, created_at")
            .eq("event_type", "login_success")
            .order("created_at", { ascending: false })
            .limit(LOGIN_LOOKBACK),
          supabase
            .from("auth_event_log")
            .select("actor_id, event_type, email, created_at")
            .order("created_at", { ascending: false })
            .limit(ACTIVITY_LOOKBACK),
          supabase
            .from("audit_log")
            .select("actor_id, action, table_name, old_data, new_data, created_at")
            .in("table_name", [...INSTITUTIONAL_AUDIT_TABLES])
            .order("created_at", { ascending: false })
            .limit(ACTIVITY_LOOKBACK),
        ]);

      if (profilesResult.error) throw profilesResult.error;
      if (magistrateResult.error) throw magistrateResult.error;
      if (clerkResult.error) throw clerkResult.error;
      if (loginResult.error) throw loginResult.error;
      if (authResult.error) throw authResult.error;
      if (auditResult.error) throw auditResult.error;

      const activityEvents: ActivityEventRow[] = [
        ...(authResult.data ?? []).map((row) => ({
          actorId: row.actor_id,
          createdAt: row.created_at,
          label: summarizeAuthEvent(row.event_type as AuthEventType, row.email).title,
        })),
        ...(auditResult.data ?? []).map((row) => ({
          actorId: row.actor_id,
          createdAt: row.created_at,
          label: summarizeChange(
            row.table_name,
            row.action as AuditAction,
            row.old_data as Json | null,
            row.new_data as Json | null,
          ).title,
        })),
      ];

      return buildAdminPeopleRows({
        profiles: (profilesResult.data ?? []) as ProfileRow[],
        magistrateAssignments: (magistrateResult.data ?? []).map((row) => ({
          profile_id: row.profile_id,
          court_id: row.court_id,
          assignment_type: row.assignment_type,
          courts: asCourtJoin(row.courts),
        })),
        clerkAssignments: (clerkResult.data ?? []).map((row) => ({
          profile_id: row.profile_id,
          court_id: row.court_id,
          courts: asCourtJoin(row.courts),
        })),
        loginEvents: loginResult.data ?? [],
        activityEvents,
      });
    },
  });
}
