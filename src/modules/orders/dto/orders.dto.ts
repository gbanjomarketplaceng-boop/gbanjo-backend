import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { MAX_QTY } from "../../cart/dto/cart.dto";
import { PaymentDto } from "../../payments/dto/payments.dto";

/** Shipment stages, in order (index = stage). */
export const STAGES = ["Order confirmed", "Packed", "Shipped", "Out for delivery", "Delivered"] as const;
export const SHIPPING_METHODS = ["standard", "express"] as const;
export const ORDER_PAY_METHODS = ["card", "bank-transfer", "ussd", "wallet"] as const;

export class CheckoutItemDto {
  @ApiProperty({ example: "olive-low-top-sneakers", description: "Product id (slug)" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  productId!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  qty!: number;

  @ApiPropertyOptional({ example: "Pink, Size M" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  option?: string;
}

export class CheckoutDto {
  @ApiProperty({ enum: SHIPPING_METHODS, example: "standard", description: "standard (free, 5–7 days) or express (1–2 days)" })
  @IsIn(SHIPPING_METHODS)
  shipping!: (typeof SHIPPING_METHODS)[number];

  @ApiProperty({ enum: ORDER_PAY_METHODS, example: "card", description: "wallet pays at once; the others open Flutterwave" })
  @IsIn(ORDER_PAY_METHODS)
  paymentMethod!: (typeof ORDER_PAY_METHODS)[number];

  @ApiPropertyOptional({ example: "GBANJO10" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  voucher?: string;

  @ApiPropertyOptional({ description: "Saved address to deliver to (defaults to your default address)" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  addressId?: string;

  @ApiPropertyOptional({ example: "Romina Williams", description: "Instead of a saved address" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipient?: string;

  @ApiPropertyOptional({ example: "+2349045654356", description: "Contact phone for the delivery (defaults to the address's phone)" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: "24 Maple Street, Ikotun, Lagos", description: "Instead of a saved address" })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: "romina@example.com", description: "Where to send the receipt (defaults to your account email)" })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ type: [CheckoutItemDto], description: "What to buy. Leave out to buy everything in your cart." })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items?: CheckoutItemDto[];

  @ApiPropertyOptional({ example: "https://www.gbanjomarket.com/checkout/complete", description: "Card payments: page to return to after paying (`reference` and `status` are added)" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnUrl?: string;
}

export class CheckVoucherDto {
  @ApiProperty({ example: "GBANJO10" })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;
}

export class VoucherDto {
  @ApiProperty({ example: "GBANJO10" }) code!: string;
  @ApiProperty({ example: 10 }) percentOff!: number;
}

export class ListOrdersQuery {
  @ApiPropertyOptional({ enum: ["buy", "sell"], default: "buy", description: "Orders you placed, or orders for your listings" })
  @IsOptional()
  @IsIn(["buy", "sell"])
  side?: "buy" | "sell";

  @ApiPropertyOptional({ enum: ["ongoing", "completed", "canceled"] })
  @IsOptional()
  @IsIn(["ongoing", "completed", "canceled"])
  status?: "ongoing" | "completed" | "canceled";
}

export class AdminListOrdersQuery {
  @ApiPropertyOptional({ enum: ["ongoing", "completed", "canceled"] })
  @IsOptional()
  @IsIn(["ongoing", "completed", "canceled"])
  status?: "ongoing" | "completed" | "canceled";
}

export class OrderItemDto {
  @ApiPropertyOptional({ example: "olive-low-top-sneakers", description: "Product slug (link to /products/:id)" }) productId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: "Pink, Size M" }) option!: string;
  @ApiProperty({ example: 17000, description: "Price of one" }) price!: number;
  @ApiProperty({ example: "/images/l-olive-sneakers.png" }) image!: string;
  @ApiProperty({ example: 1 }) qty!: number;
}

class PersonDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "Femi Tayo" }) name!: string;
}

class EtaDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
}

class ShippingDto {
  @ApiProperty({ enum: SHIPPING_METHODS }) method!: string;
  @ApiProperty({ example: 0 }) fee!: number;
}

export class OrderDto {
  @ApiProperty({ example: "92287157", description: "Order number" }) id!: string;
  @ApiProperty({ enum: ["buy", "sell"], description: "Whether you bought or sold this" }) side!: "buy" | "sell";
  @ApiProperty({ enum: ["ongoing", "completed", "canceled"] }) status!: "ongoing" | "completed" | "canceled";
  @ApiProperty({ example: 1, description: `0–4: ${STAGES.join(", ")}` }) stage!: number;
  @ApiProperty({ example: "Packed" }) stageLabel!: string;
  @ApiProperty({ type: [String], nullable: true, description: "When each stage was reached (ISO dates; null if not yet)" }) stageTimes!: (string | null)[];
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty({ example: "Romina Williams" }) recipient!: string;
  @ApiProperty({ example: "+2349045654356" }) phone!: string;
  @ApiProperty({ example: "24 Maple Street, Ikotun, Lagos" }) address!: string;
  @ApiPropertyOptional({ nullable: true }) email!: string | null;
  @ApiProperty({ description: "When it was paid for (or created)" }) placedAt!: Date;
  @ApiProperty({ type: EtaDto }) eta!: EtaDto;
  @ApiProperty({ type: ShippingDto }) shipping!: ShippingDto;
  @ApiProperty({ example: 17000 }) subtotal!: number;
  @ApiProperty({ example: 0 }) discount!: number;
  @ApiProperty({ example: 17000 }) total!: number;
  @ApiPropertyOptional({ nullable: true }) voucher!: string | null;
  @ApiProperty({ example: "card", description: "card | bank-transfer | ussd | wallet" }) paidWith!: string;
  @ApiProperty() paymentReference!: string;
  @ApiProperty({ type: PersonDto }) buyer!: PersonDto;
  @ApiPropertyOptional({ type: PersonDto, nullable: true, description: "Null when Gbanjo sells the item" }) seller!: PersonDto | null;
  @ApiProperty({ description: "You can cancel it now" }) canCancel!: boolean;
  @ApiProperty({ description: "You can move it to the next stage (seller / admin)" }) canAdvance!: boolean;
  @ApiPropertyOptional({ nullable: true, example: "Packed", description: "The stage canAdvance moves it to" }) nextStage!: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveredAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) canceledAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, enum: ["buyer", "seller", "admin", "system"] }) canceledBy!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ["card", "wallet"], description: "Where the refund went" }) refundTo!: string | null;
}

export class CheckoutResultDto {
  @ApiProperty({ type: PaymentDto, description: "Card payments: open payment.checkoutUrl. Wallet payments are already successful." }) payment!: PaymentDto;
  @ApiProperty({ type: [OrderDto], description: "One order per seller" }) orders!: OrderDto[];
}

export class AdvanceOrderDto {
  @ApiPropertyOptional({ description: "The stage you saw (0–4). If the order has moved on since, nothing changes and you get 409 ORDER_CHANGED — so a double-click can't skip a stage.", minimum: 0, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  fromStage?: number;
}
