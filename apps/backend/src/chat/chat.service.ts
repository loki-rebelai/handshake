import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface ChatError {
  code: string;
  message: string;
}

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);
  private systemPrompt = 'You are a helpful assistant for SilkyWay.';
  private readonly agentId: string;

  constructor(private readonly configService: ConfigService) {
    this.agentId = this.configService.get<string>('OPENCLAW_AGENT_ID', 'main');
  }

  async onModuleInit() {
    try {
      const promptPath = join(__dirname, 'prompts', 'system-prompt.txt');
      this.systemPrompt = await readFile(promptPath, 'utf-8');
      this.logger.log('Loaded system prompt');
    } catch {
      this.logger.warn('Could not load system-prompt.txt, using default');
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<string> {
    // Note: OpenClaw agents have their own system prompts in their workspace
    // The system-prompt.txt file in this service is no longer used
    // System context should be configured in OpenClaw agent's workspace (SOUL.md/AGENTS.md)

    // Build openclaw command
    const cmd = `openclaw agent --message ${this.escapeShellArg(message)} --agent ${this.escapeShellArg(this.agentId)} --session-id ${this.escapeShellArg(sessionId)} --json`;

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // Extract JSON from stdout (openclaw may output UI text before JSON)
      const jsonStart = stdout.indexOf('{');
      if (jsonStart === -1) {
        this.logger.error(`No JSON found in openclaw output: ${stdout}`);
        throw { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
      }

      // Parse JSON response
      const jsonOutput = stdout.substring(jsonStart);
      const result = JSON.parse(jsonOutput);

      // Extract response content from openclaw agent output
      // OpenClaw agent returns: { result: { payloads: [{ text: "..." }] } }
      const payloads = result?.result?.payloads;
      if (!payloads || !Array.isArray(payloads) || payloads.length === 0) {
        this.logger.error(`Invalid response structure from openclaw agent: ${jsonOutput}`);
        throw { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
      }

      const content = payloads[0]?.text;
      if (!content) {
        this.logger.error(`Empty response from openclaw agent: ${jsonOutput}`);
        throw { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
      }

      return content;
    } catch (err: any) {
      // Handle specific error cases
      if (err.code === 'ENOENT') {
        this.logger.error('openclaw CLI not found in PATH');
        throw { code: 'OPENCLAW_UNAVAILABLE', message: 'Support chat is temporarily unavailable' };
      }

      if (err.code === 'ETIMEDOUT') {
        this.logger.error('openclaw agent command timed out');
        throw { code: 'OPENCLAW_UNAVAILABLE', message: 'Support chat is temporarily unavailable' };
      }

      // Log stderr if available
      if (err.stderr) {
        this.logger.error(`openclaw agent stderr: ${err.stderr}`);
      }

      this.logger.error(`openclaw agent error: ${err.message || JSON.stringify(err)}`);
      throw { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
    }
  }

  private escapeShellArg(arg: string): string {
    // Escape single quotes and wrap in single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
