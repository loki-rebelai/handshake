import {
  Controller,
  Post,
  Body,
  HttpCode,
  BadRequestException,
  ServiceUnavailableException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { Public } from '../api/auth/public.decorator';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 10000;

@Public()
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(200)
  async sendMessage(@Body() body: { agentId: string; message: string }) {
    // Validate agentId
    if (!body.agentId) {
      throw new BadRequestException({
        ok: false,
        error: 'INVALID_AGENT_ID',
        message: 'agentId is required',
      });
    }
    if (!UUID_V4_REGEX.test(body.agentId)) {
      throw new BadRequestException({
        ok: false,
        error: 'INVALID_AGENT_ID',
        message: 'agentId must be a valid UUID',
      });
    }

    // Validate message
    if (!body.message || body.message.trim().length === 0) {
      throw new BadRequestException({
        ok: false,
        error: 'INVALID_MESSAGE',
        message: 'message is required',
      });
    }
    if (body.message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({
        ok: false,
        error: 'INVALID_MESSAGE',
        message: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
      });
    }

    this.logger.log(
      `Chat request from ${body.agentId} (${body.message.length} chars)`,
    );
    const start = Date.now();

    try {
      const message = await this.chatService.sendMessage(body.agentId, body.message);

      this.logger.log(`Chat response for ${body.agentId} in ${Date.now() - start}ms`);

      return {
        ok: true,
        data: { message, agentId: body.agentId },
      };
    } catch (err: any) {
      if (err?.code === 'OPENCLAW_UNAVAILABLE') {
        throw new ServiceUnavailableException({
          ok: false,
          error: 'OPENCLAW_UNAVAILABLE',
          message: 'Support chat is temporarily unavailable',
        });
      }

      this.logger.error(`Chat error for ${body.agentId}: ${err?.message || err}`);
      throw new InternalServerErrorException({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
}
