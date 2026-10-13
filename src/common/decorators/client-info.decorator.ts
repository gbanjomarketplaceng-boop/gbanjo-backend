import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

/** Caller IP and user agent, stored on sessions so users can see their signed-in devices. */
export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) };
});
