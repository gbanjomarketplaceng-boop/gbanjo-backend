import { Logger, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { setupSwagger } from "./config/swagger";
import { validationPipe } from "./common/utils/validation";
import type { Env } from "./config/env.validation";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const prefix = config.get("API_PREFIX", { infer: true });

  if (config.get("TRUST_PROXY", { infer: true })) app.set("trust proxy", 1);
  app.use(helmet());
  // gzip/brotli-sized JSON: product lists and the home page shrink ~80% on mobile data.
  app.use(compression({ threshold: 1024 }));
  app.enableCors({
    origin: config
      .get("CORS_ORIGINS", { infer: true })
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.setGlobalPrefix(prefix);
  // Routes live under /api/v1/...; health stays at /api/health.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(validationPipe());
  app.enableShutdownHooks();

  const swaggerEnabled = config.get("SWAGGER_ENABLED", { infer: true }) ?? config.get("NODE_ENV", { infer: true }) !== "production";
  if (swaggerEnabled) setupSwagger(app, prefix);

  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  const base = `http://localhost:${port}/${prefix}`;
  Logger.log(`Gbanjo API on ${base}/v1${swaggerEnabled ? ` · docs ${base}/docs` : ""}`, "Bootstrap");
}

void bootstrap();
