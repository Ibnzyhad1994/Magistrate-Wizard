import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useAdminPeople, type AdminPersonRow } from "@/hooks/admin/use-admin-people";
import { ROLE_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";

const ASSIGNMENT_TYPE_LABEL: Record<string, string> = {
  regular: "Primary",
  acting: "Acting",
  relief: "Relief",
  other: "Other",
};

const courtLabel = (person: AdminPersonRow) => {
  if (person.courts.length === 0) return "None";
  return person.courts
    .map((court) => {
      if (court.kind === "clerk") return `${court.courtName} (clerk)`;
      const type = court.assignmentType
        ? ASSIGNMENT_TYPE_LABEL[court.assignmentType] ?? court.assignmentType
        : null;
      return type && type !== "Primary" ? `${court.courtName} (${type})` : court.courtName;
    })
    .join(", ");
};

const matchesQuery = (person: AdminPersonRow, query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    person.fullName,
    person.email,
    ROLE_LABELS[person.role],
    courtLabel(person),
    person.lastActivityLabel,
  ].some((part) => (part ?? "").toLowerCase().includes(needle));
};

/**
 * Admin directory of accounts: who is seated where, when they last signed
 * in, and their most recent institutional activity. Private judicial
 * writing is never listed here.
 */
export default function PeopleAdminPage() {
  const [query, setQuery] = useState("");
  const { data: people, isPending, isError, error, refetch } = useAdminPeople();

  const visible = useMemo(() => (people ?? []).filter((person) => matchesQuery(person, query)), [people, query]);

  return (
    <BrowsePage>
      <BrowseHeader
        title="People"
        description="Every account, the court they are assigned to, last sign-in, and latest institutional activity."
      />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {isPending ? "Loading…" : `${visible.length} of ${people?.length ?? 0} accounts`}
        </p>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, court, or role"
          aria-label="Search people"
          className="max-w-xs"
        />
      </div>

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query.trim() ? "No matching accounts" : "No accounts"}
          description={
            query.trim()
              ? "Try a different name, email, court, or role."
              : "No profiles are visible to this administrator account."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Court assigned</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((person) => (
              <TableRow key={person.id}>
                <TableCell>
                  <p className="font-medium text-foreground">{person.fullName || "Unnamed"}</p>
                  <p className="text-xs text-muted-foreground">{person.email}</p>
                  {!person.isActive ? (
                    <Badge variant="outline" className="mt-1">
                      Inactive
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{ROLE_LABELS[person.role]}</Badge>
                </TableCell>
                <TableCell className="max-w-[18rem] text-sm text-foreground">
                  {courtLabel(person)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {person.lastLoginAt ? formatDateTime(person.lastLoginAt) : "Never"}
                </TableCell>
                <TableCell className="max-w-[16rem]">
                  {person.lastActivityAt ? (
                    <Link
                      to={`${ROUTES.adminActivity}?q=${encodeURIComponent(person.email)}`}
                      className="block text-sm text-foreground underline-offset-2 hover:underline"
                    >
                      <span className="line-clamp-2">{person.lastActivityLabel ?? "Recorded event"}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatDateTime(person.lastActivityAt)}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-sm text-muted-foreground">None recorded</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </BrowsePage>
  );
}
