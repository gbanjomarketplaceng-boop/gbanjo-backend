import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Every error the API returns has this shape (see AllExceptionsFilter). */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 }) statusCode!: number;
  @ApiProperty({ example: "Bad Request" }) error!: string;
  @ApiProperty({ example: "VALIDATION_FAILED", description: "Stable code to switch on, e.g. INVALID_CREDENTIALS, TOKEN_EXPIRED, PRODUCT_NOT_FOUND" }) code!: string;
  @ApiProperty({ example: "Enter a valid email address", description: "Safe to show to users" }) message!: string;
  @ApiPropertyOptional({
    example: { fields: { email: "Enter a valid email address" } },
    description: "Per-field messages for VALIDATION_FAILED (details.fields), or extra context such as attemptsRemaining / retryAfter",
  })
  details?: Record<string, unknown>;
  @ApiProperty({ example: "/api/v1/auth/login" }) path!: string;
  @ApiProperty({ example: "2026-10-13T21:00:00.000Z" }) timestamp!: string;
}
