import { config } from "dotenv";

/**
 * E2E tests run against a separate database and Redis DB so they never touch your dev data.
 * Set TEST_DATABASE_URL in .env (defaults to the dev URL with the database name suffixed _test).
 */
config({ quiet: true });

// globalSetup and every test file load this; only rewrite the URL once.
if (!process.env.GBANJO_TEST_ENV) {
  process.env.GBANJO_TEST_ENV = "1";
  const devUrl = process.env.DATABASE_URL ?? "";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? devUrl.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2");
}
process.env.NODE_ENV = "test";
process.env.SMS_PROVIDER = "console"; // never send real texts from tests
process.env.REDIS_DB = process.env.TEST_REDIS_DB ?? "15";
process.env.OTP_DEV_CODE = "1234";
process.env.OTP_LENGTH = "4";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "0";
process.env.OTP_MAX_SENDS_PER_HOUR = "100";
process.env.LOGIN_MAX_ATTEMPTS = "3";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-123";
