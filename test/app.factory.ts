import { VersioningType, type INestApplication } from "@nestjs/common";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { AppException } from "../src/common/exceptions/app.exception";
import { OAuthVerifierService, type OAuthIdentity } from "../src/modules/auth/services/oauth-verifier.service";
import { validationPipe } from "../src/common/utils/validation";
import { PrismaService } from "../src/prisma/prisma.service";
import { REDIS } from "../src/redis/redis.constants";

/**
 * Stands in for Google/Apple in tests. A token is `ok:<sub>:<email>` (email may be empty);
 * anything else is rejected like a bad signature.
 */
export const fakeOAuthVerifier = {
  async google({ idToken, code }: { idToken?: string; code?: string }): Promise<OAuthIdentity> {
    return { provider: "GOOGLE", ...parseFakeToken(idToken ?? code), firstName: "Romina", lastName: "Williams", avatarUrl: "https://example.com/a.png" };
  },
  async apple({ idToken, firstName, lastName }: { idToken: string; firstName?: string; lastName?: string }): Promise<OAuthIdentity> {
    return { provider: "APPLE", ...parseFakeToken(idToken), firstName, lastName };
  },
};

function parseFakeToken(token?: string) {
  const [ok, sub, email] = (token ?? "").split(":");
  if (ok !== "ok" || !sub) {
    throw new AppException(401, "INVALID_OAUTH_TOKEN", "We couldn't confirm your sign-in. Please try again.");
  }
  return { providerUserId: sub, email: email || undefined };
}

/** Boots the real app (same pipes/versioning as main.ts) against the test DB and Redis. */
export async function createTestApp(customize: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b) {
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] }).overrideProvider(OAuthVerifierService).useValue(fakeOAuthVerifier)).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(validationPipe());
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get<Redis>(REDIS);
  const reset = async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "sessions", "users" CASCADE');
    await redis.flushdb();
  };
  return { app, prisma, redis, reset };
}
