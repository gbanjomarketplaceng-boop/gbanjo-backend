import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined);

/** Every env var the app reads. The app refuses to start if one is missing or invalid. */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    API_PREFIX: z.string().default("api"),
    /** Comma-separated list of browser origins allowed to call the API (the web app). */
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
    /** Set to true when running behind a load balancer / reverse proxy so client IPs are correct. */
    TRUST_PROXY: bool.default(false),
    SWAGGER_ENABLED: bool.optional(),

    DATABASE_URL: z.string().url(),

    /** One URL instead of the REDIS_* parts (Render Key Value, Upstash…): redis://user:pass@host:6379/0 or rediss:// for TLS. */
    REDIS_URL: optionalString,
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.coerce.number().int().min(0).default(0),

    // Auth
    JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

    // Social sign-in. A provider whose settings are missing answers OAUTH_NOT_CONFIGURED.
    /** OAuth "Web application" client ID from Google Cloud. The mobile app uses it as its webClientId too. */
    GOOGLE_CLIENT_ID: optionalString,
    /** Needed for the web sign-in popup (it sends an authorization code the API exchanges). */
    GOOGLE_CLIENT_SECRET: optionalString,
    /** Comma-separated audiences Apple ID tokens may be issued for: the iOS bundle ID and, for the web, the Services ID. */
    APPLE_CLIENT_IDS: z.string().default("com.gbanjo.app"),

    // Email (SMTP). When EMAIL_HOST_USER + EMAIL_HOST_PASSWORD and a host or service are set, emails are really sent;
    // otherwise they're printed in the server log.
    /** nodemailer service name, e.g. "gmail" — sets host and port for you. */
    EMAIL_SERVICE: optionalString,
    EMAIL_HOST: optionalString,
    EMAIL_PORT: z.coerce.number().int().positive().default(587),
    /** true for port 465 (implicit TLS); false uses STARTTLS on 587. */
    EMAIL_SECURE: bool.optional(),
    EMAIL_HOST_USER: optionalString,
    EMAIL_HOST_PASSWORD: optionalString,
    /** Sender shown to users, e.g. "Gbanjo <no-reply@gbanjo.com>". Defaults to EMAIL_HOST_USER. */
    EMAIL_FROM: optionalString,

    // Image uploads (Cloudinary). Either the three values, or CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud name>.
    CLOUDINARY_CLOUD_NAME: optionalString,
    CLOUDINARY_API_KEY: optionalString,
    CLOUDINARY_API_SECRET: optionalString,
    CLOUDINARY_URL: optionalString,
    /** Top-level folder for this environment's uploads, e.g. "gbanjo" or "gbanjo-dev". */
    CLOUDINARY_FOLDER: z.string().default("gbanjo"),

    // Text messages. SMS_PROVIDER picks the gateway; with SMS_FALLBACK_ENABLED the other one is tried if it fails.
    // A gateway without its API key + sender ID is skipped; with none set up, texts are printed to the log.
    SMS_PROVIDER: z.enum(["termii", "emisri", "console"]).default("termii"),
    SMS_FALLBACK_ENABLED: bool.default(true),
    TERMII_API_KEY: optionalString,
    TERMII_SENDER_ID: optionalString,
    TERMII_BASE_URL: z.string().url().default("https://api.ng.termii.com"),
    /** "dnd" (reaches every number, for OTPs; must be enabled on your Termii account) or "generic". */
    TERMII_CHANNEL: z.enum(["dnd", "generic"]).default("dnd"),
    EMISRI_API_KEY: optionalString,
    EMISRI_SENDER_ID: optionalString,
    EMISRI_BASE_URL: z.string().url().default("https://api.emisri.com/v1"),
    EMISRI_EXCLUDE_DND: bool.default(false),

    /** Inbox that receives Contact-page messages. */
    SUPPORT_EMAIL: z.string().email().default("support@gbanjo.com"),

    // One-time codes (SMS / email)
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(4),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
    OTP_MAX_SENDS_PER_HOUR: z.coerce.number().int().positive().default(5),
    /** Development only: every code is this value instead of a random one. Rejected in production. */
    OTP_DEV_CODE: z
      .string()
      .regex(/^\d{4,8}$/, "must be 4-8 digits")
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.OTP_DEV_CODE)
      ctx.addIssue({ code: "custom", path: ["OTP_DEV_CODE"], message: "must not be set in production" });
    if (env.OTP_DEV_CODE && env.OTP_DEV_CODE.length !== env.OTP_LENGTH)
      ctx.addIssue({ code: "custom", path: ["OTP_DEV_CODE"], message: `must be ${env.OTP_LENGTH} digits (OTP_LENGTH)` });
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
