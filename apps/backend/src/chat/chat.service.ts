import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

interface ChatError {
  code: string;
  message: string;
}

const MAX_MESSAGES_PER_SESSION = 50;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface Session {
  messages: Anthropic.MessageParam[];
  lastAccess: number;
}

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private systemPrompt = 'You are a helpful assistant for SilkyWay.';
  private client: Anthropic;
  private sessions = new Map<string, Session>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
    this.cleanupTimer = setInterval(() => this.evictExpiredSessions(), SESSION_TTL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async onModuleInit() {
    let behavioralPrompt: string | null = null;
    let knowledgeBase: string | null = null;

    try {
      const promptPath = join(__dirname, 'prompts', 'system-prompt.txt');
      behavioralPrompt = await readFile(promptPath, 'utf-8');
    } catch {
      this.logger.warn('Could not load system-prompt.txt');
    }

    try {
      const skillPath = join(__dirname, '..', '..', 'content', 'skill.md');
      const raw = await readFile(skillPath, 'utf-8');
      // Strip YAML frontmatter (--- ... ---)
      knowledgeBase = raw.replace(/^---[\s\S]*?---\n*/, '');
      // Strip the "POST /chat" section (circular — chat agent doesn't need docs about itself)
      knowledgeBase = knowledgeBase.replace(
        /### POST \/chat[\s\S]*?(?=\n## |\n$)/,
        '',
      );
    } catch {
      this.logger.warn('Could not load content/skill.md');
    }

    if (behavioralPrompt && knowledgeBase) {
      this.systemPrompt = behavioralPrompt + '\n\n' + knowledgeBase;
      this.logger.log(
        `Loaded system prompt with knowledge base (${this.systemPrompt.length} chars)`,
      );
    } else if (behavioralPrompt) {
      this.systemPrompt = behavioralPrompt;
      this.logger.log('Loaded system prompt (no knowledge base)');
    } else {
      this.logger.warn(
        'Using default system prompt — see https://docs.silkyway.ai',
      );
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<string> {
    const session = this.sessions.get(sessionId) ?? { messages: [], lastAccess: Date.now() };
    session.lastAccess = Date.now();
    session.messages.push({ role: 'user', content: message });

    // Trim oldest message pairs if over limit
    while (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages.splice(0, 2);
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: this.systemPrompt,
        messages: session.messages,
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!text) {
        this.logger.error('Empty response from Claude API');
        throw { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } as ChatError;
      }

      session.messages.push({ role: 'assistant', content: text });
      this.sessions.set(sessionId, session);

      return text;
    } catch (err: any) {
      if (err.code === 'INTERNAL_ERROR') throw err;

      this.logger.error(`Claude API error: ${err.message || JSON.stringify(err)}`);
      throw { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } as ChatError;
    }
  }

  private evictExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastAccess > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}
