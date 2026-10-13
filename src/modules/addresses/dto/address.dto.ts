import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from "class-validator";
import type { Address } from "../../../generated/prisma/client";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value);

export class CreateAddressDto {
  @ApiProperty({ example: "Home" })
  @Transform(trim)
  @IsString()
  @Length(1, 40, { message: "Give the address a label, e.g. Home" })
  label!: string;

  @ApiProperty({ example: "Romina Williams" })
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: "Enter the name of the person receiving the delivery" })
  name!: string;

  @ApiProperty({ example: "09045654356", description: "Nigerian mobile number, any common format" })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: "239 Muri Okunola St, Victoria Island, Lagos" })
  @Transform(trim)
  @IsString()
  @Length(5, 300, { message: "Enter the full address (at least 5 characters)" })
  address!: string;

  @ApiPropertyOptional({ description: "Make this the default address. The first address is always the default." })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 40, { message: "Give the address a label, e.g. Home" }) label?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80, { message: "Enter the name of the person receiving the delivery" }) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(5, 300, { message: "Enter the full address (at least 5 characters)" }) address?: string;
  @ApiPropertyOptional({ description: "true makes it the default" }) @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class AddressDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "Home" }) label!: string;
  @ApiProperty({ example: "Romina Williams" }) name!: string;
  @ApiProperty({ example: "+2349045654356" }) phone!: string;
  @ApiProperty() address!: string;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() createdAt!: Date;

  static from(a: Address): AddressDto {
    return { id: a.id, label: a.label, name: a.name, phone: a.phone, address: a.address, isDefault: a.isDefault, createdAt: a.createdAt };
  }
}
