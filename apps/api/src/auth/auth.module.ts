import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordService,
    OtpService,
    TokenService,
    PermissionsService,
    JwtAuthGuard,
    PermissionsGuard,
  ],
  exports: [PermissionsService, PasswordService, TokenService, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
