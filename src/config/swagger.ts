import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { ErrorResponseDto } from "../common/dto/error-response.dto";

const TAGS: [string, string][] = [
  ["Auth", "Sign-up with phone OTP, login, Google/Apple, sessions, forgot/change password"],
  ["Users", "The signed-in user's profile"],
  ["Wallet", "Wallet balance"],
  ["Addresses", "Saved delivery addresses; the default one is used at checkout"],
  ["Catalog", "Categories, products, search and the home page rails (public)"],
  ["Banners", "Home-page slides (admins manage them)"],
  ["Reviews", "Star ratings and comments on products"],
  ["Wishlist", "Saved items"],
  ["Cart", "Shopping cart"],
  ["Selling", "Seller ID verification and listings"],
  ["Chat", "Buyer ↔ seller messages, with live updates over Server-Sent Events"],
  ["Uploads", "Signed Cloudinary uploads for photos and ID documents"],
  ["Contact", "Contact-page messages"],
  ["Health", "Liveness / readiness"],
];

const ERRORS: Record<string, string> = {
  "400": "Invalid input (code VALIDATION_FAILED with details.fields) or a business rule (see code)",
  "401": "Missing/expired token (code UNAUTHORIZED or TOKEN_EXPIRED → refresh and retry)",
  "403": "Not allowed (e.g. ADMIN_ONLY, VERIFICATION_REQUIRED)",
  "404": "Not found",
  "429": "Too many requests — wait and try again",
};

/**
 * Post-processing so the docs match how the API really behaves:
 * every route needs a Bearer token unless it's @Public (global guard), and every error uses ErrorResponseDto.
 */
function finish(doc: OpenAPIObject): OpenAPIObject {
  const ref = { $ref: "#/components/schemas/ErrorResponseDto" };
  for (const item of Object.values(doc.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const op = item[method];
      if (!op) continue;
      const isPublic = (op as unknown as Record<string, unknown>)["x-public"] === true;
      delete (op as unknown as Record<string, unknown>)["x-public"];
      op.security = isPublic ? [] : [{ bearer: [] }];
      op.responses ??= {};
      for (const [status, description] of Object.entries(ERRORS)) {
        if (status === "401" && isPublic) continue;
        if (status === "403" && isPublic) continue;
        if (!op.responses[status]) op.responses[status] = { description, content: { "application/json": { schema: ref } } };
      }
    }
  }
  return doc;
}

/** Interactive API docs at /api/docs and the raw OpenAPI JSON at /api/docs-json (import it into Postman/Insomnia). */
export function createSwaggerDocument(app: INestApplication) {
  const builder = new DocumentBuilder()
    .setTitle("Gbanjo API")
    .setDescription(
      "Marketplace API for the Gbanjo mobile app and website. All routes are under `/api/v1`.\n\n" +
        "**Auth:** click **Authorize** and paste an access token (from `POST /v1/auth/login` or `/v1/auth/verify-phone`). " +
        "Routes with a lock need it. Access tokens last 15 minutes; swap the refresh token at `POST /v1/auth/refresh` " +
        "when you get a 401 with code `TOKEN_EXPIRED`.\n\n" +
        "**Errors** always look like `ErrorResponseDto` — switch on `code`, show `message`; form errors are in `details.fields`.\n\n" +
        "**Prices** are whole naira (NGN). **Phones** are Nigerian mobiles; any common format is accepted and returned as `+234…`.",
    )
    .setVersion("1.0")
    .setContact("Gbanjo", "https://gbanjo.com", "support@gbanjo.com")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Access token" }, "bearer");
  for (const [name, description] of TAGS) builder.addTag(name, description);
  const doc = SwaggerModule.createDocument(app, builder.build(), { extraModels: [ErrorResponseDto] });
  return finish(doc);
}

export function setupSwagger(app: INestApplication, prefix: string) {
  SwaggerModule.setup(`${prefix}/docs`, app, () => createSwaggerDocument(app), {
    jsonDocumentUrl: `${prefix}/docs-json`,
    customSiteTitle: "Gbanjo API docs",
    swaggerOptions: { persistAuthorization: true, docExpansion: "none", filter: true, tagsSorter: "alpha", operationsSorter: "method", displayRequestDuration: true },
  });
}
