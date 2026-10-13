import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min } from "class-validator";
import { UPLOAD_PURPOSES, type UploadPurpose } from "../uploads.constants";

export class SignUploadDto {
  @ApiProperty({ enum: UPLOAD_PURPOSES })
  @IsIn(UPLOAD_PURPOSES, { message: `purpose must be one of ${UPLOAD_PURPOSES.join(", ")}` })
  purpose!: UploadPurpose;
}

export class UploadSignatureDto {
  @ApiProperty({ example: "https://api.cloudinary.com/v1_1/demo/image/upload" }) uploadUrl!: string;
  @ApiProperty({
    description: "Send every field as multipart form data together with `file`, unchanged",
    example: { api_key: "1234", timestamp: "1760000000", signature: "abc…", folder: "gbanjo/listings/u1", allowed_formats: "jpg,png", type: "upload" },
  })
  fields!: Record<string, string>;
  @ApiProperty({ example: 10485760 }) maxBytes!: number;
}

/** What Cloudinary answered after the upload — the API checks Cloudinary's signature before trusting it. */
export class ConfirmUploadDto {
  @ApiProperty({ enum: UPLOAD_PURPOSES })
  @IsIn(UPLOAD_PURPOSES)
  purpose!: UploadPurpose;

  @ApiProperty({ example: "gbanjo/listings/cmv…/abc123" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  @Matches(/^[\w\-/]+$/, { message: "Invalid public_id" })
  publicId!: string;

  @ApiProperty({ example: 1760000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ description: "`signature` from Cloudinary's upload response" })
  @IsString()
  @Matches(/^[a-f0-9]{40,64}$/, { message: "Invalid signature" })
  signature!: string;
}

export class UploadedImageDto {
  @ApiProperty() publicId!: string;
  @ApiProperty({ description: "Public HTTPS URL, or a signed link that expires (private ID images)" }) url!: string;
  @ApiProperty() private!: boolean;
  @ApiPropertyOptional({ description: "When `url` stops working (private images only)" }) expiresAt?: Date;
}

export class DeleteUploadDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  @Matches(/^[\w\-/]+$/, { message: "Invalid public_id" })
  publicId!: string;

  @ApiProperty({ enum: UPLOAD_PURPOSES })
  @IsIn(UPLOAD_PURPOSES)
  purpose!: UploadPurpose;
}
