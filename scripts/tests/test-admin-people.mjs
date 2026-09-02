import { buildAdminPeopleRows } from "@/hooks/admin/use-admin-people"

let failures = 0
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

const rows = buildAdminPeopleRows({
  profiles: [
    { id: "m1", full_name: "Local Magistrate", email: "magistrate@court.gy", role: "magistrate", is_active: true },
    { id: "a1", full_name: "Local Administrator", email: "admin@court.gy", role: "admin", is_active: true },
    { id: "c1", full_name: null, email: "clerk@court.gy", role: "clerk", is_active: false },
  ],
  magistrateAssignments: [
    {
      profile_id: "m1",
      court_id: "court-geo",
      assignment_type: "regular",
      courts: { id: "court-geo", name: "Georgetown" },
    },
    {
      profile_id: "a1",
      court_id: "court-geo",
      assignment_type: "acting",
      courts: { id: "court-geo", name: "Georgetown" },
    },
  ],
  clerkAssignments: [
    {
      profile_id: "c1",
      court_id: "court-prov",
      courts: { id: "court-prov", name: "Providence" },
    },
  ],
  loginEvents: [
    { actor_id: "a1", email: "admin@court.gy", created_at: "2026-09-01T12:00:00Z" },
    { actor_id: "a1", email: "admin@court.gy", created_at: "2026-08-01T12:00:00Z" },
    { actor_id: null, email: "magistrate@court.gy", created_at: "2026-08-15T08:00:00Z" },
  ],
  activityEvents: [
    { actorId: "a1", createdAt: "2026-09-01T12:05:00Z", label: "Magistrate assigned to a court" },
    { actorId: "a1", createdAt: "2026-08-20T10:00:00Z", label: "Signed in" },
    { actorId: "m1", createdAt: "2026-08-15T08:01:00Z", label: "Signed in" },
  ],
})

check(
  "sorts by display name, falling back to email",
  rows.map((row) => row.id),
  ["c1", "a1", "m1"],
)

const admin = rows.find((row) => row.id === "a1")
const magistrate = rows.find((row) => row.id === "m1")
const clerk = rows.find((row) => row.id === "c1")

check("admin keeps the later login, not an earlier one", admin?.lastLoginAt, "2026-09-01T12:00:00Z")
check("login can match by email when actor_id is missing", magistrate?.lastLoginAt, "2026-08-15T08:00:00Z")
check("clerk with no login events is null", clerk?.lastLoginAt, null)
check("inactive flag is preserved", clerk?.isActive, false)

check("admin acting seating is listed", admin?.courts.map((c) => `${c.courtName}:${c.assignmentType}`), ["Georgetown:acting"])
check("clerk court is tagged as clerk kind", clerk?.courts[0]?.kind, "clerk")
check("latest activity wins over an older sign-in", admin?.lastActivityLabel, "Magistrate assigned to a court")
check("latest activity timestamp is the later event", admin?.lastActivityAt, "2026-09-01T12:05:00Z")

const unorderedLogin = buildAdminPeopleRows({
  profiles: [{ id: "a1", full_name: "Admin", email: "admin@court.gy", role: "admin", is_active: true }],
  magistrateAssignments: [],
  clerkAssignments: [],
  loginEvents: [
    { actor_id: "a1", email: "admin@court.gy", created_at: "2026-01-01T00:00:00Z" },
    { actor_id: "a1", email: "admin@court.gy", created_at: "2026-09-01T12:00:00Z" },
  ],
  activityEvents: [],
})
check("last login is the newest timestamp even if events are not pre-sorted", unorderedLogin[0]?.lastLoginAt, "2026-09-01T12:00:00Z")

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
