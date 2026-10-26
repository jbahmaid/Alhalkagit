import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MeDto, PendingVerificationDto, REFRESH_COOKIE, RefreshResultDto, SessionDto } from '@sanad/shared';
import type { Request, Response } from 'express';
import { AllowPendingPasswordChange, AuthUser, CurrentUser, Public } from '../common/decorators';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { AuthService, ClientMeta, IssuedSession } from './auth.service';
import { clearSessionCookies, setSessionCookies } from './cookies';
import {
  ChangePasswordDto,
  EmailDto,
  LoginDto,
  ResetPasswordDto,
  SignupSeekerDto,
  UpdateMeDto,
  VerifyEmailDto,
} from './dto/auth.dto';

/** Strict limits for endpoints that guess secrets or send email (per client IP). */
const STRICT = { default: { limit: 10, ttl: 60_000 } };
const EMAIL_SENDING = { default: { limit: 5, ttl: 60_000 } };

function clientMeta(req: Request): ClientMeta {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private respond(res: Response, issued: IssuedSession): SessionDto {
    setSessionCookies(res, {
      refreshToken: issued.refreshToken,
      expiresAt: issued.refreshExpiresAt,
      role: issued.session.user.role,
      secure: this.config.cookies.secure,
    });
    return issued.session;
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('signup/seeker')
  signupSeeker(@Body() dto: SignupSeekerDto): Promise<PendingVerificationDto> {
    return this.auth.signupSeeker(dto);
  }

  @Public()
  @Throttle(STRICT)
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    return this.respond(res, await this.auth.verifyEmail(dto.email, dto.code, clientMeta(req)));
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('verify-email/resend')
  @HttpCode(200)
  resend(@Body() dto: EmailDto): Promise<PendingVerificationDto> {
    return this.auth.resendVerification(dto.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    return this.respond(res, await this.auth.login(dto, clientMeta(req)));
  }

  /** Silent refresh. Always 200: `{ authenticated: false, code }` when there is no valid session. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<RefreshResultDto> {
    const out = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientMeta(req));
    if ('issued' in out) {
      this.respond(res, out.issued);
    } else if (out.clearCookies) {
      clearSessionCookies(res, this.config.cookies.secure);
    }
    return out.result;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], clientMeta(req));
    clearSessionCookies(res, this.config.cookies.secure);
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() dto: EmailDto): Promise<{ ok: true }> {
    await this.auth.forgotPassword(dto.email);
    return { ok: true };
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request): Promise<{ ok: true }> {
    await this.auth.resetPassword(dto, clientMeta(req));
    return { ok: true };
  }

  @AllowPendingPasswordChange()
  @Throttle(STRICT)
  @Post('password/change')
  @HttpCode(200)
  async change(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    return this.respond(res, await this.auth.changePassword(user.id, dto, clientMeta(req)));
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @AllowPendingPasswordChange()
  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }

  /** Saves the preferred language (used for emails). */
  @AllowPendingPasswordChange()
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto): Promise<MeDto> {
    return this.auth.updateLocale(user.id, dto.locale);
  }
}
