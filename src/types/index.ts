export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
  Profile,
  Court,
  Case,
  CaseParty,
  BenchNote,
  Statute,
  CaseLaw,
  Tag,
  Document,
  Comment,
  Bookmark,
  AuditLogEntry,
  SearchResult,
} from "./database.types";

import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles?: Array<"magistrate" | "clerk" | "admin">;
}

export interface ApiError {
  message: string;
  code?: string;
}
