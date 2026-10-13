import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Error with a stable machine-readable `code` (e.g. INVALID_CREDENTIALS) that clients can switch on,
 * plus a human message they can show as-is.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}
