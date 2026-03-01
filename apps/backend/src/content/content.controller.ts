import {
  Controller,
  Get,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { readFile, stat } from 'fs/promises';
import { join, resolve, normalize } from 'path';
import { Public } from '../api/auth/public.decorator';

const CONTENT_DIR = join(__dirname, '..', '..', 'content');

@Public()
@Controller()
export class ContentController {
  @Get('/')
  async root(@Req() req: Request, @Res() res: Response) {
    const accept = req.headers.accept || '';
    const wantsMd = 'md' in req.query;
    if (!wantsMd && accept.includes('text/html') && !accept.includes('text/markdown')) {
      return res.redirect(302, '/human');
    }
    return this.serveMarkdown(res, 'index.md');
  }

  @Get('agent')
  async agent(@Res() res: Response) {
    return this.serveMarkdown(res, 'index.md');
  }

  @Get('human')
  async human(@Res() res: Response) {
    return this.serveHtml(res);
  }

  @Get('humans')
  async humansRedirect(@Res() res: Response) {
    res.redirect(301, '/human');
  }

  @Get('llms.txt')
  async llmsTxt(@Res() res: Response) {
    return this.serveMarkdown(res, 'llms.txt');
  }

  @Get('skill.md')
  async skillMd(@Res() res: Response) {
    return this.serveMarkdown(res, 'skill.md');
  }

  @Get('nav.md')
  async navMd(@Res() res: Response) {
    return this.serveMarkdown(res, 'nav.md');
  }

  @Get('CHANGELOG.md')
  async changelogMd(@Res() res: Response) {
    return this.serveMarkdown(res, 'CHANGELOG.md');
  }

  @Get('examples/basic-escrow.md')
  async basicEscrowMd(@Res() res: Response) {
    return this.serveMarkdown(res, 'examples/basic-escrow.md');
  }

  private async serveHtml(res: Response) {
    const htmlPath = join(__dirname, 'landing.html');

    try {
      const [htmlContent, fileStat] = await Promise.all([
        readFile(htmlPath, 'utf-8'),
        stat(htmlPath),
      ]);

      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Last-Modified': fileStat.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=300',
      });

      res.send(htmlContent);
    } catch {
      throw new NotFoundException();
    }
  }

  private async serveMarkdown(res: Response, relativePath: string) {
    const filePath = resolve(CONTENT_DIR, normalize(relativePath));

    // Prevent directory traversal
    if (!filePath.startsWith(CONTENT_DIR)) {
      throw new NotFoundException();
    }

    try {
      const [content, fileStat] = await Promise.all([
        readFile(filePath, 'utf-8'),
        stat(filePath),
      ]);

      res.set({
        'Content-Type': 'text/markdown; charset=utf-8',
        'Last-Modified': fileStat.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=300',
      });

      res.send(content);
    } catch {
      throw new NotFoundException();
    }
  }
}
