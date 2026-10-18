import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class DeleteAccountDto {
  @ApiPropertyOptional({ description: "Your password (accounts that have one)" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @ApiPropertyOptional({ example: "DELETE", description: "Google/Apple accounts without a password type DELETE" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  confirm?: string;
}
