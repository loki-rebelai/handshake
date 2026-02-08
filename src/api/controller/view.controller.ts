import { Controller, Get, Param, Res, NotFoundException, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { TransferService } from '../service/transfer.service';
import { Transfer, TransferStatus } from '../../db/models/Transfer';

const EXPLORER = 'https://solscan.io';
const CLUSTER = 'devnet';
const PROGRAM_ID = 'HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg';

function explorerAddr(addr: string): string {
  return `${EXPLORER}/account/${addr}?cluster=${CLUSTER}`;
}

function explorerTx(sig: string): string {
  return `${EXPLORER}/tx/${sig}?cluster=${CLUSTER}`;
}

function shortAddr(addr: string): string {
  return addr.slice(0, 4) + '...' + addr.slice(-4);
}

function statusBadge(status: TransferStatus): string {
  const colors: Record<string, string> = {
    ACTIVE: '#22c55e',
    CLAIMED: '#3b82f6',
    CANCELLED: '#ef4444',
    REJECTED: '#f97316',
    EXPIRED: '#6b7280',
    DECLINED: '#a855f7',
  };
  const color = colors[status] || '#6b7280';
  return `<span style="background:${color}; color:#fff; padding:2px 8px; border-radius:4px; font-size:0.8rem; font-weight:500;">${status}</span>`;
}

function formatAmount(amountRaw: string, decimals: number): string {
  const n = Number(amountRaw) / 10 ** decimals;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Silkyway</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --solar-gold: #fbbf24;
      --solar-amber: #f59e0b;
      --nebula-purple: #a855f7;
      --deep-space: #0c0015;
      --space-mid: #1a0a2e;
      --star-white: #faf5ff;
      --card-bg: rgba(26, 10, 46, 0.8);
      --border: rgba(168, 85, 247, 0.2);
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background: var(--deep-space);
      color: var(--star-white);
      font-family: 'DM Mono', monospace;
      min-height: 100vh;
      padding: 2rem;
    }
    a { color: var(--solar-gold); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 960px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.5rem; color: var(--solar-gold); margin-bottom: 0.25rem; }
    .header .sub { font-size: 0.85rem; color: rgba(250,245,255,0.6); }
    .nav { text-align: center; margin-bottom: 2rem; font-size: 0.8rem; }
    .nav a { margin: 0 0.75rem; color: var(--nebula-purple); }
    .stats { display: flex; gap: 1.5rem; justify-content: center; margin-bottom: 2rem; flex-wrap: wrap; }
    .stat { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.5rem; text-align: center; }
    .stat .value { font-size: 1.5rem; color: var(--solar-gold); font-weight: 500; }
    .stat .label { font-size: 0.7rem; color: rgba(250,245,255,0.5); text-transform: uppercase; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { text-align: left; padding: 0.75rem; color: var(--nebula-purple); border-bottom: 1px solid var(--border); font-size: 0.7rem; text-transform: uppercase; }
    td { padding: 0.75rem; border-bottom: 1px solid rgba(168,85,247,0.08); }
    tr:hover { background: rgba(168,85,247,0.05); }
    .detail-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 2rem; }
    .detail-row { display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid rgba(168,85,247,0.1); }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: rgba(250,245,255,0.5); font-size: 0.75rem; text-transform: uppercase; }
    .detail-value { font-size: 0.85rem; text-align: right; max-width: 60%; word-break: break-all; }
    .amount-large { font-size: 2rem; color: var(--solar-gold); text-align: center; margin: 1.5rem 0; }
    .footer { text-align: center; margin-top: 3rem; font-size: 0.7rem; color: rgba(250,245,255,0.3); }
    .program-link { color: var(--solar-gold); font-size: 0.75rem; }
    .empty { text-align: center; padding: 3rem; color: rgba(250,245,255,0.4); }
    @media (max-width: 768px) {
      body { padding: 1rem; }
      table { font-size: 0.7rem; }
      td, th { padding: 0.5rem 0.25rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav">
      <a href="/human">Home</a>
      <a href="/activity">Activity</a>
      <a href="/skill.md">Skill</a>
      <a href="/">Agent Docs</a>
    </div>
    ${body}
    <div class="footer">
      <a class="program-link" href="${explorerAddr(PROGRAM_ID)}" target="_blank" rel="noopener">${PROGRAM_ID}</a>
      <br>Silkyway &middot; Programmable USDC Escrow on Solana Devnet
    </div>
  </div>
</body>
</html>`;
}

@Controller()
export class ViewController {
  constructor(private readonly transferService: TransferService) {}

  @Get('activity')
  async activity(@Res() res: Response) {
    const [transfers, total] = await Promise.all([
      this.transferService.findRecent(50),
      this.transferService.countAll(),
    ]);

    const active = transfers.filter(t => t.status === TransferStatus.ACTIVE).length;
    const claimed = transfers.filter(t => t.status === TransferStatus.CLAIMED).length;

    let rows = '';
    if (transfers.length === 0) {
      rows = `<tr><td colspan="6" class="empty">No transfers yet. Be the first — <code>silk pay</code></td></tr>`;
    } else {
      for (const t of transfers) {
        const amount = formatAmount(t.amountRaw, t.token?.decimals ?? 6);
        const symbol = t.token?.symbol ?? 'USDC';
        rows += `<tr>
          <td>${statusBadge(t.status)}</td>
          <td>${amount} ${symbol}</td>
          <td><a href="${explorerAddr(t.sender)}" target="_blank" rel="noopener" title="${t.sender}">${shortAddr(t.sender)}</a></td>
          <td><a href="${explorerAddr(t.recipient)}" target="_blank" rel="noopener" title="${t.recipient}">${shortAddr(t.recipient)}</a></td>
          <td>${t.memo || '—'}</td>
          <td><a href="/activity/${t.transferPda}">${shortAddr(t.transferPda)}</a> · ${timeAgo(t.createdAt)}</td>
        </tr>`;
      }
    }

    const body = `
    <div class="header">
      <h1>Transfer Activity</h1>
      <div class="sub">Live escrow transfers on Solana devnet</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="value">${total}</div><div class="label">Total Transfers</div></div>
      <div class="stat"><div class="value">${active}</div><div class="label">Active (in escrow)</div></div>
      <div class="stat"><div class="value">${claimed}</div><div class="label">Claimed</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Status</th><th>Amount</th><th>Sender</th><th>Recipient</th><th>Memo</th><th>Transfer</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=15' });
    res.send(pageShell('Transfer Activity', body));
  }

  @Get('activity/:pda')
  async transferDetail(@Param('pda') pda: string, @Res() res: Response) {
    try {
      new PublicKey(pda);
    } catch {
      throw new BadRequestException('Invalid PDA');
    }

    const transfer = await this.transferService.findByPda(pda);
    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    const amount = formatAmount(transfer.amountRaw, transfer.token?.decimals ?? 6);
    const symbol = transfer.token?.symbol ?? 'USDC';

    function txLink(txid: string | undefined, label: string): string {
      if (!txid) return '—';
      return `<a href="${explorerTx(txid)}" target="_blank" rel="noopener">${shortAddr(txid)} ↗</a>`;
    }

    function dateStr(d: Date | undefined): string {
      if (!d) return '—';
      return d.toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
    }

    const body = `
    <div class="header">
      <h1>Transfer Detail</h1>
      <div class="sub"><a href="${explorerAddr(transfer.transferPda)}" target="_blank" rel="noopener">${transfer.transferPda}</a></div>
    </div>
    <div class="detail-card">
      <div class="amount-large">${amount} ${symbol}</div>
      <div style="text-align:center; margin-bottom:1.5rem;">${statusBadge(transfer.status)}</div>
      <div class="detail-row"><span class="detail-label">Sender</span><span class="detail-value"><a href="${explorerAddr(transfer.sender)}" target="_blank" rel="noopener">${transfer.sender}</a></span></div>
      <div class="detail-row"><span class="detail-label">Recipient</span><span class="detail-value"><a href="${explorerAddr(transfer.recipient)}" target="_blank" rel="noopener">${transfer.recipient}</a></span></div>
      <div class="detail-row"><span class="detail-label">Memo</span><span class="detail-value">${transfer.memo || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Pool</span><span class="detail-value"><a href="${explorerAddr(transfer.pool?.poolPda)}" target="_blank" rel="noopener">${shortAddr(transfer.pool?.poolPda ?? '')}</a> (${transfer.pool?.feeBps ?? 0} bps fee)</span></div>
      <div class="detail-row"><span class="detail-label">Token Mint</span><span class="detail-value"><a href="${explorerAddr(transfer.token?.mint ?? '')}" target="_blank" rel="noopener">${transfer.token?.mint ?? '—'}</a></span></div>
      <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${dateStr(transfer.createdAt)}</span></div>
      <div class="detail-row"><span class="detail-label">Create Tx</span><span class="detail-value">${txLink(transfer.createTxid, 'Create')}</span></div>
      <div class="detail-row"><span class="detail-label">Claim Tx</span><span class="detail-value">${txLink(transfer.claimTxid, 'Claim')}</span></div>
      <div class="detail-row"><span class="detail-label">Cancel Tx</span><span class="detail-value">${txLink(transfer.cancelTxid, 'Cancel')}</span></div>
      ${transfer.claimableAfter ? `<div class="detail-row"><span class="detail-label">Claimable After</span><span class="detail-value">${dateStr(transfer.claimableAfter)}</span></div>` : ''}
      ${transfer.claimableUntil ? `<div class="detail-row"><span class="detail-label">Claimable Until</span><span class="detail-value">${dateStr(transfer.claimableUntil)}</span></div>` : ''}
    </div>`;

    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=15' });
    res.send(pageShell(`Transfer ${shortAddr(pda)}`, body));
  }
}
