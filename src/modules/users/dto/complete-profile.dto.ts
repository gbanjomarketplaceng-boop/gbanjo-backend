import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, Length, MaxLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** Fills in what a Google/Apple sign-up didn't give us. No SMS code is needed. */
export class CompleteProfileDto {
  @ApiProperty({ example: "Romina" })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: "Enter your first name" })
  firstName!: string;

  @ApiProperty({ example: "Williams" })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: "Enter your last name" })
  lastName!: string;

  @ApiProperty({ example: "09045654356", description: "Nigerian mobile number, any common format (0…, 234…, +234…)" })
  @IsString()
  @IsNotEmpty({ message: "Enter your phone number" })
  @MaxLength(20)
  phone!: string;
}
