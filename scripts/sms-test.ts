/**
 * Sends one test text through the SMS settings in .env (same code the app uses), to check your Termii / Emisri setup.
 *   npm run sms:test -- 08031234567                 (uses SMS_PROVIDER, with fallback if enabled)
 *   npm run sms:test -- 08031234567 --only=emisri   (just that gateway)
 */
import "dotenv/config";
import { normalizeNigerianPhone } from "../src/common/utils/phone";
import { validateEnv } from "../src/config/env.validation";
import { createSmsChannel } from "../src/modules/notifications/channels/sms/sms-channel.factory";

async function main() {
  const phone = normalizeNigerianPhone(process.argv.find((a) => /\d{7,}/.test(a)) ?? "");
  if (!phone) throw new Error("Usage: npm run sms:test -- 08031234567 [--only=termii|emisri]");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const env = validateEnv({ ...process.env, ...(only ? { SMS_PROVIDER: only, SMS_FALLBACK_ENABLED: "false" } : {}) });
  const sms = createSmsChannel({ get: (k: keyof typeof env) => env[k] } as never);
  await sms.send(phone, "Gbanjo test message: your SMS setup works.");
  console.log(`Sent to ${phone}. Check the phone (and the log line above for which gateway was used).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
