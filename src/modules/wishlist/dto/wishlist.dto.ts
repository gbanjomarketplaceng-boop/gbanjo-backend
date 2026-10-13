import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsString, MaxLength } from "class-validator";

export class MergeWishlistDto {
  @ApiProperty({ type: [String], description: "Product ids (slugs) saved while signed out", example: ["olive-low-top-sneakers"] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  productIds!: string[];
}
