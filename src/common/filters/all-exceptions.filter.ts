import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client";

/** Shape of every error response. */
export interface ErrorBody {
  statusCode: number;
  error: string;
  /** Stable code clients can switch on, e.g. INVALID_CREDENTIALS, VALIDATION_FAILED. */
  code: string;
  /** Human-readable, safe to show to users. */
  message: string;
  /** Field errors for VALIDATION_FAILED, or extra context. */
  details?: Record<string, unknown>;
  path: string;
  timestamp: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
};

/** 400 → "Bad Request" */
const statusText = (status: number) =>
  (HttpStatus[status] ?? "Error")
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message = "Something went wrong. Please try again.";
    let details: Record<string, unknown> | undefined;

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = "TOO_MANY_REQUESTS";
      message = "Too many requests. Please wait a moment and try again.";
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = CODE_BY_STATUS[status] ?? "ERROR";
      if (typeof body === "string") message = body;
      else if (body && typeof body === "object") {
        const b = body as { code?: string; message?: string | string[]; details?: Record<string, unknown> };
        if (b.code) code = b.code;
        if (Array.isArray(b.message)) message = b.message[0] ?? message;
        else if (b.message) message = b.message;
        details = b.details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === "P2002") {
      status = HttpStatus.CONFLICT;
      code = "CONFLICT";
      message = "That record already exists.";
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const body: ErrorBody = {
      statusCode: status,
      error: statusText(status),
      code,
      message,
      ...(details ? { details } : {}),
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
  }
}
