import { execSync } from "node:child_process";
import "./env";

/** Applies migrations to the test database once before the suite (set SKIP_MIGRATE=1 to skip). */
export default function globalSetup() {
  if (process.env.SKIP_MIGRATE === "1") return;
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}
