import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import type { Env } from "../../config/env.validation";
import { NotificationsModule } from "../notifications/notifications.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { LoginAttemptsService } from "./services/login-attempts.service";
import { OAuthVerifierService } from "./services/oauth-verifier.service";
import { OtpService } from "./services/otp.service";
import { PasswordService } from "./services/password.service";
import { TokenService } from "./services/token.service";
import { JwtStrategy } from "./strategies/jwt.strategy";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get("JWT_ACCESS_SECRET", { infer: true }),
        signOptions: { algorithm: "HS256", issuer: "gbanjo-api" },
        verifyOptions: { algorithms: ["HS256"], issuer: "gbanjo-api" },
      }),
    }),
    UsersModule,
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, OtpService, TokenService, LoginAttemptsService, OAuthVerifierService, JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
