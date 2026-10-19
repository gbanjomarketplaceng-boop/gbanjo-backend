import { SetMetadata } from "@nestjs/common";
import type { AdminRole } from "../../generated/prisma/client";

/** Parts of the admin panel. Each admin role can use some of them (SUPER: all). */
export const ADMIN_AREAS = ["dashboard", "finance", "orders", "users", "moderation", "catalog", "content", "team", "settings"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

export const ROLE_AREAS: Record<AdminRole, readonly AdminArea[]> = {
  SUPER: ADMIN_AREAS,
  FINANCE: ["dashboard", "finance", "orders", "users"],
  SUPPORT: ["dashboard", "orders", "users", "moderation"],
  CATALOG: ["dashboard", "catalog", "content", "moderation"],
};

export const ADMIN_AREA = "adminArea";
/** Limits a route (or controller) to admins whose role includes one of these areas. Without it, any admin may use it. */
export const AdminOnly = (...areas: AdminArea[]) => SetMetadata(ADMIN_AREA, areas);

export const areasFor = (role: AdminRole | null | undefined): readonly AdminArea[] => ROLE_AREAS[role ?? "SUPER"];
