import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { ProductDto } from "../../catalog/dto/catalog.dto";

/** Most of one item a cart can hold. */
export const MAX_QTY = 99;

export class AddCartItemDto {
  @ApiProperty({ example: "olive-low-top-sneakers", description: "Product id (slug)" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  productId!: string;

  @ApiPropertyOptional({ example: 1, default: 1, description: "Added to what's already in the cart" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  qty?: number;

  @ApiPropertyOptional({ example: "Pink, Size M" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  option?: string;
}

export class UpdateCartItemDto {
  @ApiPropertyOptional({ example: 2, description: "New quantity (replaces the old one)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  qty?: number;

  @ApiPropertyOptional({ example: "Blue, Size L" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  option?: string;
}

export class MergeCartDto {
  @ApiProperty({ type: [AddCartItemDto], description: "The cart kept on this device while signed out" })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AddCartItemDto)
  items!: AddCartItemDto[];
}

export class CartLineDto {
  @ApiProperty({ type: ProductDto }) product!: ProductDto;
  @ApiProperty({ example: 1 }) qty!: number;
  @ApiProperty({ example: "Pink, Size M" }) option!: string;
}

export class CartDto {
  @ApiProperty({ type: [CartLineDto] }) items!: CartLineDto[];
  @ApiProperty({ example: 3, description: "Total quantity" }) count!: number;
  @ApiProperty({ example: 51000, description: "Sum of price × qty (NGN)" }) subtotal!: number;
}
