import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { PaymentsModule } from "../payments/payments.module";
import { UsersModule } from "../users/users.module";
import { WalletModule } from "../wallet/wallet.module";
import { AdminOpsController } from "./admin-ops.controller";
import { AdminOpsService } from "./admin-ops.service";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminAuditInterceptor } from "./audit.interceptor";

/** The admin panel's API: overview, people, moderation, money, catalog, team, settings and the activity log. */
@Module({
  imports: [PaymentsModule, WalletModule, UsersModule],
  controllers: [AdminController, AdminOpsController],
  providers: [AdminService, AdminOpsService, { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor }],
})
export class AdminModule {}
