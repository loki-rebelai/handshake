import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import type { IntentV2 as Intent } from '@silkysquad/silk';
import { IntentBuildService } from '../../services/intent/intent-build.service';
import { IntentAnalyzeService } from '../../services/intent/intent-analyze.service';

@Controller('api/intent')
export class IntentController {
  constructor(
    private readonly intentBuildService: IntentBuildService,
    private readonly intentAnalyzeService: IntentAnalyzeService,
  ) {}

  @Post('build')
  @HttpCode(200)
  async build(
    @Body() body: { intent?: Intent; analyze?: boolean; feePayer?: string },
  ) {
    if (!body.intent) {
      throw new BadRequestException({
        ok: false,
        error: 'MISSING_INTENT',
        message: 'intent is required',
      });
    }

    if (!body.intent.chain) {
      throw new BadRequestException({
        ok: false,
        error: 'MISSING_CHAIN',
        message: 'intent.chain is required',
      });
    }

    try {
      const build = await this.intentBuildService.build(body.intent, {
        feePayer: body.feePayer,
      });

      if (body.analyze) {
        const analysis = await this.intentAnalyzeService.analyze(
          build.transaction,
          body.intent,
        );

        return {
          ok: true,
          data: {
            ...build,
            analysis,
          },
        };
      }

      return {
        ok: true,
        data: build,
      };
    } catch (err: any) {
      throw new BadRequestException({
        ok: false,
        error: 'INTENT_BUILD_FAILED',
        message: err?.message || 'Intent build failed',
      });
    }
  }

  @Post('analyze')
  @HttpCode(200)
  async analyze(@Body() body: { transaction?: string; intent?: Intent }) {
    if (!body.transaction) {
      throw new BadRequestException({
        ok: false,
        error: 'MISSING_TRANSACTION',
        message: 'transaction is required',
      });
    }

    if (!body.intent) {
      throw new BadRequestException({
        ok: false,
        error: 'MISSING_INTENT',
        message: 'intent is required',
      });
    }

    if (!body.intent.chain) {
      throw new BadRequestException({
        ok: false,
        error: 'MISSING_CHAIN',
        message: 'intent.chain is required',
      });
    }

    try {
      const analysis = await this.intentAnalyzeService.analyze(
        body.transaction,
        body.intent,
      );

      return {
        ok: true,
        data: analysis,
      };
    } catch (err: any) {
      throw new BadRequestException({
        ok: false,
        error: 'INTENT_ANALYZE_FAILED',
        message: err?.message || 'Intent analysis failed',
      });
    }
  }
}
