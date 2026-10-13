import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const REVIEW_SORTS = ["newest", "highest", "lowest"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export class SaveReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  @Type(() => Number)
  @IsInt({ message: "Choose a rating from 1 to 5 stars" })
  @Min(1, { message: "Choose a rating from 1 to 5 stars" })
  @Max(5, { message: "Choose a rating from 1 to 5 stars" })
  rating!: number;

  @ApiPropertyOptional({ example: "Great quality, fits well.", maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(1000, { message: "Keep your review under 1000 characters" })
  text?: string;
}

export class ReviewsQuery {
  @ApiPropertyOptional({ enum: REVIEW_SORTS, default: "newest" })
  @IsOptional()
  @IsIn(REVIEW_SORTS)
  sort: ReviewSort = "newest";

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

export class ReviewAuthorDto {
  @ApiProperty({ example: "Veronika A." }) name!: string;
  @ApiPropertyOptional() avatar?: string;
}

export class ReviewDto {
  @ApiProperty() id!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) rating!: number;
  @ApiProperty() text!: string;
  @ApiProperty({ type: ReviewAuthorDto }) author!: ReviewAuthorDto;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ description: "Changed after it was first posted" }) edited!: boolean;
}

export class RatingSummaryDto {
  @ApiProperty({ example: 4.3, description: "Average, 1 decimal (0 when there are no reviews)" }) average!: number;
  @ApiProperty({ example: 12 }) count!: number;
  @ApiProperty({ example: { "5": 6, "4": 4, "3": 1, "2": 1, "1": 0 }, description: "How many reviews gave each star rating" })
  breakdown!: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export class ReviewPageDto {
  @ApiProperty({ type: [ReviewDto] }) items!: ReviewDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ type: RatingSummaryDto }) summary!: RatingSummaryDto;
}

export class MyReviewDto {
  @ApiPropertyOptional({ type: ReviewDto, nullable: true }) review!: ReviewDto | null;
  @ApiProperty({ description: "False for your own listing" }) canReview!: boolean;
}
