import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { WalletModule } from "../wallet/wallet.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

/** Flutterwave card payments (checkout and wallet top-ups). Other modules register what happens when a payment succeeds. */
@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
