import { applyDecorators, SetMetadata } from "@nestjs/common";
import { ApiExtension } from "@nestjs/swagger";

export const IS_PUBLIC_KEY = "isPublic";

/** Skips the global JWT guard for a route or controller (and shows it without a lock in Swagger). */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension("x-public", true));
