import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiConflictResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CompleteProfileDto } from "./dto/complete-profile.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UserResponseDto } from "./dto/user-response.dto";
import { UsersService } from "./users.service";

@ApiTags("Users")
@ApiBearerAuth()
@Controller({ path: "users", version: "1" })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  @ApiOperation({ summary: "Get the signed-in user's profile" })
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.users.getOrThrow(user.id));
  }

  @Post("me/complete-profile")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Add the name and phone number missing after a Google/Apple sign-up (no SMS code)" })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: "PHONE_TAKEN or PHONE_LOCKED" })
  async completeProfile(@CurrentUser() user: AuthUser, @Body() dto: CompleteProfileDto): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.users.completeProfile(user.id, dto));
  }

  @Patch("me")
  @ApiOperation({ summary: "Update name, email or avatar" })
  @ApiOkResponse({ type: UserResponseDto })
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.users.updateProfile(user.id, dto));
  }

  @Delete("me")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete your account (password, or confirm: \"DELETE\" for Google/Apple accounts). Signs out everywhere." })
  @ApiNoContentResponse()
  @ApiConflictResponse({ description: "HAS_OPEN_ORDERS, WALLET_NOT_EMPTY or WITHDRAWAL_IN_PROGRESS" })
  remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto): Promise<void> {
    return this.users.deleteAccount(user.id, dto);
  }
}
