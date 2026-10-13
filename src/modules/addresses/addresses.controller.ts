import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { AddressesService } from "./addresses.service";
import { AddressDto, CreateAddressDto, UpdateAddressDto } from "./dto/address.dto";

/** Every call returns the full, updated list (default first). */
@ApiTags("Addresses")
@ApiBearerAuth()
@Controller({ path: "addresses", version: "1" })
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: "My saved addresses (default first)" })
  @ApiOkResponse({ type: [AddressDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: "Add an address (the first one becomes the default)" })
  @ApiOkResponse({ type: [AddressDto] })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAddressDto) {
    return this.addresses.create(user.id, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit an address, or make it the default with { isDefault: true }" })
  @ApiOkResponse({ type: [AddressDto] })
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateAddressDto) {
    return this.addresses.update(user.id, id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an address (if it was the default, the newest other one takes over)" })
  @ApiOkResponse({ type: [AddressDto] })
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.addresses.remove(user.id, id);
  }
}
