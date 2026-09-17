export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from "./database.types";
export type * from "./db-aliases";

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
