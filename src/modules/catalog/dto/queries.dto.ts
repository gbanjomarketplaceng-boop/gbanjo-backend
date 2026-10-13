import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() || undefined : value);
/** "a,b , c" → ["a","b","c"] */
const csv = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(value) ? value : undefined;

export const SORTS = ["relevance", "newest", "price_asc", "price_desc", "rating", "popular"] as const;
export type ProductSort = (typeof SORTS)[number];

export class ListProductsQuery {
  @ApiPropertyOptional({ description: "Search words (any order) in name, tags, category and description" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: "clothing", description: "Category slug" })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[a-z0-9-]+$/, { message: "Unknown category" })
  category?: string;

  @ApiPropertyOptional({ enum: SORTS, description: "Default: relevance when searching, otherwise newest" })
  @IsOptional()
  @IsIn(SORTS, { message: `sort must be one of ${SORTS.join(", ")}` })
  sort?: ProductSort;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 24, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  limit = 24;
}

export class LimitQuery {
  @ApiPropertyOptional({ default: 8, maximum: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  limit?: number;
}

export class JustForYouQuery extends LimitQuery {
  @ApiPropertyOptional({ example: "properties", description: "Only this category (the chips on the home page)" })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[a-z0-9-]+$/, { message: "Unknown category" })
  category?: string;

  @ApiPropertyOptional({ example: "clothing,electronics", description: "Categories the shopper likes (e.g. from their wishlist/cart) — ranked first" })
  @IsOptional()
  @Transform(csv)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  prefer?: string[];

  @ApiPropertyOptional({ example: "olive-low-top-sneakers", description: "Product ids (slugs) to leave out" })
  @IsOptional()
  @Transform(csv)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  exclude?: string[];
}

export class SuggestQuery {
  @ApiPropertyOptional({ example: "sneak", description: "Empty → no suggestions" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 6, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
