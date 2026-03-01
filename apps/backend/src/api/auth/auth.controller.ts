import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';

@Controller('api/auth')
@Public()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('challenge')
  challenge(@Query('pubkey') pubkey: string) {
    if (!pubkey) {
      throw new BadRequestException({ ok: false, error: 'MISSING_FIELD', message: 'pubkey is required' });
    }
    try {
      new PublicKey(pubkey);
    } catch {
      throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: 'pubkey is not a valid public key' });
    }

    const nonce = this.authService.generateChallenge(pubkey);
    return { ok: true, data: { nonce } };
  }

  @Post('register')
  async register(@Body() body: { pubkey: string; signature: string }) {
    if (!body?.pubkey || !body?.signature) {
      throw new BadRequestException({ ok: false, error: 'MISSING_FIELD', message: 'pubkey and signature are required' });
    }
    try {
      new PublicKey(body.pubkey);
    } catch {
      throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: 'pubkey is not a valid public key' });
    }

    try {
      const apiKey = await this.authService.verifyAndIssueKey(body.pubkey, body.signature);
      return { ok: true, data: { apiKey } };
    } catch (e: any) {
      throw new UnauthorizedException({ ok: false, error: 'INVALID_SIGNATURE', message: e.message });
    }
  }

  @Post('revoke')
  async revoke(@Headers('authorization') auth: string) {
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ ok: false, error: 'MISSING_API_KEY', message: 'Authorization header required' });
    }
    const rawKey = auth.slice(7);
    try {
      await this.authService.revokeKey(rawKey);
    } catch {
      throw new UnauthorizedException({ ok: false, error: 'INVALID_API_KEY', message: 'Key not found' });
    }
    return { ok: true };
  }
}
