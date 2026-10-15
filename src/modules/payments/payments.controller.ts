import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { PaymentDto, TopUpDto, VerifyPaymentDto } from "./dto/payments.dto";
import { PaymentsService } from "./payments.service";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f7faf8;color:#06452a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.c{background:#fff;border:1px solid #e2e9e5;border-radius:16px;padding:28px;max-width:380px;width:100%;box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{color:#738078;margin:0 0 20px}button{width:100%;height:46px;border-radius:10px;border:0;font-weight:700;font-size:15px;margin-top:10px;cursor:pointer}
.pay{background:#00a94f;color:#fff}.fail{background:#fdebed;color:#c7363f}.cancel{background:#fff;border:1px solid #e2e9e5;color:#06452a}</style></head><body><div class="c">${body}</div></body></html>`;

@ApiTags("Payments")
@Controller({ path: "payments", version: "1" })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("top-up")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Start a wallet top-up — open the returned checkoutUrl (Flutterwave) to pay" })
  @ApiOkResponse({ type: PaymentDto })
  topUp(@CurrentUser() user: AuthUser, @Body() dto: TopUpDto) {
    return this.payments.topUp(user.id, dto);
  }

  @Get("flutterwave/return")
  @Public()
  @ApiOperation({ summary: "Flutterwave sends the shopper here after paying; we verify, then forward to the website/app" })
  async flutterwaveReturn(@Query() q: { tx_ref?: string; transaction_id?: string; status?: string }, @Res() res: Response) {
    const next = await this.payments.handleReturn(q);
    if (next) return res.redirect(302, next);
    res.type("html").send(page("Payment received", "<h1>Thanks!</h1><p>You can close this page and go back to Gbanjo.</p>"));
  }

  @Post("flutterwave/webhook")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Flutterwave webhook (set this URL and a secret hash on the Flutterwave dashboard)" })
  webhook(@Headers("verif-hash") hash: string | undefined, @Body() body: Record<string, never>) {
    return this.payments.handleWebhook(hash, body);
  }

  @Get("test-checkout/:reference")
  @Public()
  @ApiExcludeEndpoint()
  async testCheckout(@Param("reference") reference: string, @Res() res: Response) {
    const s = await this.payments.testCheckout().session(reference);
    if (!s) return res.status(404).type("html").send(page("Not found", "<h1>Payment not found</h1><p>This test payment has expired.</p>"));
    const action = `${this.payments.apiBase}/payments/test-checkout/${encodeURIComponent(reference)}`;
    // The buttons post here, then we redirect back to the website/app — allow that in the page's CSP.
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action * gbanjo: exp: exps:");
    const btn = (status: string, label: string, cls: string) =>
      `<form method="post" action="${esc(action)}"><input type="hidden" name="status" value="${status}"><button class="${cls}">${label}</button></form>`;
    res.type("html").send(
      page(
        "Test payment",
        `<h1>Test payment · ₦${Number(s.amount).toLocaleString("en-NG")}</h1><p>Flutterwave isn't set up on this server, so this page stands in for it. No money moves.</p>${btn("successful", "Pay", "pay")}${btn("failed", "Decline", "fail")}${btn("cancelled", "Cancel", "cancel")}`,
      ),
    );
  }

  @Post("test-checkout/:reference")
  @Public()
  @ApiExcludeEndpoint()
  async testCheckoutResult(@Param("reference") reference: string, @Body() body: { status?: string }, @Res() res: Response) {
    const status = body?.status === "successful" || body?.status === "failed" ? body.status : "cancelled";
    const done = await this.payments.testCheckout().complete(reference, status);
    if (!done) return res.status(404).send("Not found");
    const url = new URL(done.redirectUrl);
    url.searchParams.set("status", status);
    url.searchParams.set("tx_ref", reference);
    if (status !== "cancelled") url.searchParams.set("transaction_id", done.transactionId);
    res.redirect(303, url.toString());
  }

  @Get(":reference")
  @ApiBearerAuth()
  @ApiOperation({ summary: "A payment's status (and the orders it paid for)" })
  @ApiOkResponse({ type: PaymentDto })
  get(@CurrentUser() user: AuthUser, @Param("reference") reference: string) {
    return this.payments.get(user.id, reference);
  }

  @Post(":reference/verify")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ask Flutterwave again whether a pending payment went through" })
  @ApiOkResponse({ type: PaymentDto })
  verify(@CurrentUser() user: AuthUser, @Param("reference") reference: string, @Body() dto: VerifyPaymentDto) {
    return this.payments.verifyForUser(user.id, reference, dto?.status?.toLowerCase());
  }
}
