import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CacheFor } from "../../common/cache/response-cache.interceptor";
import { Public } from "../../common/decorators/public.decorator";
import { CatalogService } from "./catalog.service";
import { CategoryDto, FlashSaleDto, HomeDto, ProductDto, ProductPageDto, SuggestionsDto } from "./dto/catalog.dto";
import { JustForYouQuery, LimitQuery, ListProductsQuery, SuggestQuery } from "./dto/queries.dto";

/** Public storefront endpoints — no sign-in needed. */
@ApiTags("Catalog")
@Public()
@CacheFor(30)
@Controller({ version: "1" })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("catalog/home")
  @ApiOperation({ summary: "Home page: categories, flash sale, new items and Just For You in one call" })
  @ApiOkResponse({ type: HomeDto })
  home(@Query() query: JustForYouQuery) {
    return this.catalog.home(query.prefer);
  }

  @Get("search/suggestions")
  @ApiOperation({ summary: "Search-as-you-type: top product matches and matching categories" })
  @ApiOkResponse({ type: SuggestionsDto })
  suggestions(@Query() query: SuggestQuery) {
    return this.catalog.suggestions(query.q ?? "", query.limit);
  }

  @Get("categories")
  @ApiOperation({ summary: "All categories with their active product counts" })
  @ApiOkResponse({ type: [CategoryDto] })
  categories() {
    return this.catalog.categories();
  }

  @Get("products")
  @ApiOperation({ summary: "Browse / search products (filter by category and price, sort, paginate)" })
  @ApiOkResponse({ type: ProductPageDto })
  list(@Query() query: ListProductsQuery) {
    return this.catalog.list(query);
  }

  @Get("products/flash-sale")
  @ApiOperation({ summary: "Items in the current flash sale" })
  @ApiOkResponse({ type: FlashSaleDto })
  flashSale(@Query() query: LimitQuery) {
    return this.catalog.flashSale(query.limit);
  }

  @Get("products/new")
  @ApiOperation({ summary: "Newest listings" })
  @ApiOkResponse({ type: [ProductDto] })
  newItems(@Query() query: LimitQuery) {
    return this.catalog.newItems(query.limit);
  }

  @Get("products/just-for-you")
  @ApiOperation({ summary: "Recommended items (optionally one category, or favouring the shopper's categories)" })
  @ApiOkResponse({ type: [ProductDto] })
  justForYou(@Query() query: JustForYouQuery) {
    return this.catalog.justForYou(query);
  }

  @Get("products/:id")
  @ApiOperation({ summary: "One product by its id (URL slug)" })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse({ description: "PRODUCT_NOT_FOUND" })
  product(@Param("id") id: string) {
    return this.catalog.product(id);
  }

  @Get("products/:id/similar")
  @ApiOperation({ summary: "Similar products (same category first)" })
  @ApiOkResponse({ type: [ProductDto] })
  @ApiNotFoundResponse({ description: "PRODUCT_NOT_FOUND" })
  similar(@Param("id") id: string, @Query() query: LimitQuery) {
    return this.catalog.similar(id, query.limit);
  }
}
