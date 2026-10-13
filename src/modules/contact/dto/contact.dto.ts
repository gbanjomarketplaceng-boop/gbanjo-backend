import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from "class-validator";
import { CONTACT_TOPICS } from "../contact.constants";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class CreateContactMessageDto {
  @ApiProperty({ example: "Romina Williams" })
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: "Enter your name" })
  name!: string;

  @ApiProperty({ example: "romina@email.com" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "Enter a valid email address" })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: CONTACT_TOPICS })
  @IsIn(CONTACT_TOPICS, { message: "Choose a topic" })
  topic!: (typeof CONTACT_TOPICS)[number];

  @ApiPropertyOptional({ example: "GB-102938" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  orderRef?: string;

  @ApiProperty({ example: "Where is my order?" })
  @Transform(trim)
  @IsString()
  @Length(3, 120, { message: "Give your message a short subject" })
  subject!: string;

  @ApiProperty({ example: "Hi, I ordered … and it hasn't arrived yet." })
  @Transform(trim)
  @IsString()
  @Length(10, 4000, { message: "Tell us a bit more (at least 10 characters)" })
  message!: string;

  @ApiPropertyOptional({ description: "Leave empty. Bots fill it in; those messages are dropped." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class ContactReceiptDto {
  @ApiProperty({ example: "We've got your message and will reply by email soon." }) message!: string;
  @ApiPropertyOptional({ description: "Reference for the conversation" }) reference?: string;
}

export class UpdateContactStatusDto {
  @ApiProperty({ enum: ["NEW", "RESOLVED"] })
  @IsIn(["NEW", "RESOLVED"])
  status!: "NEW" | "RESOLVED";
}

export class ContactMessageDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() topic!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) orderRef!: string | null;
  @ApiProperty() subject!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ enum: ["NEW", "RESOLVED"] }) status!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) ipAddress!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
