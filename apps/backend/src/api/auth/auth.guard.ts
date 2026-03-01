import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthService } from './auth.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        ok: false,
        error: 'MISSING_API_KEY',
        message: 'Authorization: Bearer <api-key> header required',
      });
    }

    const rawKey = authHeader.slice(7);
    const agent = await this.authService.validateKey(rawKey);

    if (!agent) {
      throw new UnauthorizedException({
        ok: false,
        error: 'INVALID_API_KEY',
        message: 'Invalid or revoked API key',
      });
    }

    request.agent = agent;
    return true;
  }
}
