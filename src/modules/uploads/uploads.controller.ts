import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBadRequestResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { ConfirmUploadDto, DeleteUploadDto, SignUploadDto, UploadedImageDto, UploadSignatureDto } from "./dto/uploads.dto";
import { AppException } from "../../common/exceptions/app.exception";
import { PURPOSE_RULES, type UploadPurpose } from "./uploads.constants";
import { UploadsService } from "./uploads.service";

@ApiTags("Uploads")
@ApiBearerAuth()
@Controller({ path: "uploads", version: "1" })
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Banner images are the site's, so only admins may upload or delete them. */
  private assertAllowed(purpose: UploadPurpose, user: AuthUser) {
    if (PURPOSE_RULES[purpose].adminOnly && user.role !== "ADMIN")
      throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_ONLY", "Only Gbanjo admins can do this.");
  }

  @Post("signature")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Step 1: get a signature, then POST the file + `fields` to `uploadUrl` (Cloudinary)" })
  @ApiOkResponse({ type: UploadSignatureDto })
  @ApiServiceUnavailableResponse({ description: "UPLOADS_NOT_CONFIGURED" })
  sign(@CurrentUser() user: AuthUser, @Body() dto: SignUploadDto) {
    this.assertAllowed(dto.purpose, user);
    return this.uploads.sign(dto.purpose, user.id);
  }

  @Post("confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Step 2: send Cloudinary's response (public_id, version, signature) to get the image URL" })
  @ApiOkResponse({ type: UploadedImageDto })
  @ApiBadRequestResponse({ description: "INVALID_UPLOAD" })
  @ApiForbiddenResponse({ description: "NOT_YOUR_UPLOAD" })
  confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmUploadDto) {
    this.assertAllowed(dto.purpose, user);
    return this.uploads.confirm(dto.purpose, user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete one of your uploaded images" })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: "NOT_YOUR_UPLOAD" })
  async remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteUploadDto) {
    this.assertAllowed(dto.purpose, user);
    await this.uploads.remove(dto.purpose, user.id, dto.publicId);
  }
}
