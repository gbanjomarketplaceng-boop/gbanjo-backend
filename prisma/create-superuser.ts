/**
 * Creates a brand-new SUPER ADMIN account (a new user, not an existing one).
 *
 *   npm run create-superuser
 *       → asks for first name, last name, email, phone (optional) and password
 *
 *   npm run create-superuser -- --email boss@gbanjo.com --first Ada --last Okafor --password "Secret123"
 *       → no questions (add --phone +2348012345678 if you want a phone on the account)
 *
 * The account can log in straight away (email and phone are marked verified) and gets a ₦0 wallet.
 * To upgrade an account that already exists, use: npm run make-admin -- someone@email.com
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import * as argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgConnectionString } from "../src/prisma/database-url";
import { PrismaClient } from "../src/generated/prisma/client";
import { PASSWORD_MESSAGE, PASSWORD_RULE } from "../src/modules/auth/auth.constants";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pgConnectionString(process.env.DATABASE_URL!) }) });

/** Value after a flag, e.g. arg("--email"). */
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1]?.trim() : undefined;
};

/** One terminal prompt shared by all questions (so pasted/piped answers aren't lost). */
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines: string[] = [];
let waiting: ((s: string) => void) | null = null;
rl.on("line", (l) => (waiting ? (waiting(l), (waiting = null)) : lines.push(l)));
let muted = false;
const out = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WriteStream };
out._writeToOutput = (s: string) => out.output.write(muted ? s.replace(/[^\r\n]/g, "*") : s);

/** Asks a question in the terminal. `hidden` shows * instead of the password. */
function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (answer: string) => {
      muted = false;
      resolve(answer.trim());
    };
    const queued = lines.shift();
    if (queued !== undefined) done(queued);
    else waiting = done;
  });
}

async function main() {
  const firstName = arg("--first") ?? (await ask("First name: "));
  const lastName = arg("--last") ?? (await ask("Last name: "));
  const email = (arg("--email") ?? (await ask("Email: "))).toLowerCase();
  let phone: string | undefined = arg("--phone") ?? (process.argv.includes("--email") ? "" : await ask("Phone (optional, e.g. +2348012345678): "));
  let password = arg("--password");
  if (!password) {
    password = await ask("Password: ", true);
    const again = await ask("Repeat password: ", true);
    if (password !== again) throw new Error("The passwords don't match.");
  }

  if (!firstName || !lastName) throw new Error("First and last name are required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email.");
  if (!PASSWORD_RULE.test(password)) throw new Error(PASSWORD_MESSAGE);
  phone = phone ? phone.replace(/[\s-]/g, "") : undefined;
  if (phone?.startsWith("0")) phone = `+234${phone.slice(1)}`;
  if (phone && !/^\+\d{8,15}$/.test(phone)) throw new Error("Phone must look like +2348012345678.");

  const taken = await prisma.user.findFirst({ where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] }, select: { email: true } });
  if (taken)
    throw new Error(
      taken.email === email
        ? `An account with ${email} already exists. To make it a super admin run: npm run make-admin -- ${email}`
        : "That phone number is already used by another account.",
    );

  const now = new Date();
  const user = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      phone: phone ?? null,
      // Same hashing as normal sign-up (Argon2id, same settings).
      passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      role: "ADMIN",
      adminRole: "SUPER",
      status: "ACTIVE",
      emailVerifiedAt: now,
      phoneVerifiedAt: phone ? now : null,
      wallet: { create: {} },
    },
  });

  console.log(`\nSuper admin created: ${user.firstName} ${user.lastName} <${user.email}>`);
  console.log("Log in on the website with this email and password, then open /admin.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    void prisma.$disconnect();
  });
