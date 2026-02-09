'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useAtomValue } from 'jotai';
import dynamic from 'next/dynamic';
import { useConnectedWallet } from '@/hooks/useConnectedWallet';
import { useWalletActions } from '@/_jotai/wallet/wallet.actions';
import { useTransferActions } from '@/_jotai/transfer/transfer.actions';
import { walletBalanceAtom, isLoadingBalanceAtom } from '@/_jotai/wallet/wallet.state';
import { transfersAtom, isLoadingTransfersAtom } from '@/_jotai/transfer/transfer.state';

const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

export default function HomePage() {
  const { publicKey, isConnected } = useConnectedWallet();
  const { fetchBalance } = useWalletActions();
  const { fetchTransfers } = useTransferActions();
  const balance = useAtomValue(walletBalanceAtom);
  const isLoadingBalance = useAtomValue(isLoadingBalanceAtom);
  const transfers = useAtomValue(transfersAtom);
  const isLoadingTransfers = useAtomValue(isLoadingTransfersAtom);

  useEffect(() => {
    if (publicKey) {
      const addr = publicKey.toBase58();
      fetchBalance(addr);
      fetchTransfers(addr);
    }
  }, [publicKey, fetchBalance, fetchTransfers]);

  if (!isConnected) {
    return (
      <div className="relative min-h-[calc(100vh-3.5rem)]">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-center px-8" style={{ minHeight: 'calc(100vh - 3.5rem)' }}>
          <div className="animate-fade-up text-center">
            <h1 className="font-display text-4xl font-black uppercase tracking-wide bg-gradient-to-br from-[#fef3c7] via-solar-gold via-40% to-solar-orange bg-clip-text text-transparent">
              Silkyway
            </h1>
            <p className="mt-3 max-w-md text-[0.9rem] leading-relaxed text-star-white/50">
              Operator dashboard for your on-chain escrow account. View balances, send USDC transfers, and monitor activity on Solana.
            </p>
            <div className="mt-2 flex items-center justify-center gap-2 text-[0.7rem] uppercase tracking-[0.15em] text-nebula-purple/60">
              <span className="h-1.5 w-1.5 rounded-full bg-solar-gold shadow-[0_0_6px_#fbbf24] animate-status-pulse" />
              Solana Devnet
            </div>
          </div>

          <div className="animate-fade-up mt-10 w-full max-w-sm border border-nebula-purple/20 p-6" style={{ animationDelay: '100ms', background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.04) 0%, rgba(12, 0, 21, 0.6) 100%)' }}>
            <h2 className="mb-1 text-[0.8rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
              Connect Wallet
            </h2>
            <p className="mb-5 text-[0.75rem] text-star-white/35">
              Connect your Solana wallet to view your account, check balances, and manage transfers.
            </p>
            <div className="wallet-adapter-override">
              <WalletMultiButton />
            </div>
          </div>

          <div className="animate-fade-up mt-10 grid max-w-lg grid-cols-3 gap-6 text-center" style={{ animationDelay: '200ms' }}>
            <div>
              <div className="text-[0.7rem] font-medium uppercase tracking-[0.15em] text-star-white/25">Escrow</div>
              <p className="mt-1 text-[0.65rem] leading-relaxed text-star-white/15">Funds held on-chain until claimed or cancelled</p>
            </div>
            <div>
              <div className="text-[0.7rem] font-medium uppercase tracking-[0.15em] text-star-white/25">Cancellable</div>
              <p className="mt-1 text-[0.65rem] leading-relaxed text-star-white/15">Sender can reclaim anytime before recipient claims</p>
            </div>
            <div>
              <div className="text-[0.7rem] font-medium uppercase tracking-[0.15em] text-star-white/25">Agent-ready</div>
              <p className="mt-1 text-[0.65rem] leading-relaxed text-star-white/15">Built for agents and operators sharing an account</p>
            </div>
          </div>

          <footer className="absolute bottom-8 text-center">
            <div className="text-[0.6rem] uppercase tracking-[0.2em] text-nebula-purple/40">Program</div>
            <a
              href="https://solscan.io/account/HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[0.65rem] tracking-[0.03em] text-star-white/20 transition-colors hover:text-solar-gold/60"
            >
              HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg
            </a>
          </footer>
        </div>
      </div>
    );
  }

  const recentTransfers = transfers.slice(0, 5);

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      {/* Account header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.3em] text-nebula-purple/60">
            <span className="h-1.5 w-1.5 rounded-full bg-solar-gold shadow-[0_0_6px_#fbbf24] animate-status-pulse" />
            Solana Devnet
          </div>
          <p className="mt-1 text-[0.75rem] tracking-[0.05em] text-star-white/30">
            {publicKey?.toBase58()}
          </p>
        </div>
      </div>

      {/* Balance cards */}
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="panel p-6">
          <div className="mb-3 text-[0.7rem] font-medium uppercase tracking-[0.2em] text-nebula-purple/60">
            Sol Balance
          </div>
          {isLoadingBalance ? (
            <div className="h-8 w-24 animate-pulse bg-nebula-purple/10" />
          ) : (
            <div className="font-display text-3xl font-black text-star-white">
              {balance?.sol != null ? balance.sol.toFixed(4) : '—'}
              <span className="ml-2 text-base font-normal text-star-white/30">SOL</span>
            </div>
          )}
        </div>

        {balance?.tokens.map((token) => (
          <div key={token.mint} className="panel p-6">
            <div className="mb-3 text-[0.7rem] font-medium uppercase tracking-[0.2em] text-nebula-purple/60">
              {token.symbol} Balance
            </div>
            <div className="font-display text-3xl font-black text-star-white">
              {Number(token.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              <span className="ml-2 text-base font-normal text-star-white/30">{token.symbol}</span>
            </div>
          </div>
        ))}

        {!isLoadingBalance && (!balance?.tokens || balance.tokens.length === 0) && (
          <div className="panel p-6">
            <div className="mb-3 text-[0.7rem] font-medium uppercase tracking-[0.2em] text-nebula-purple/60">
              Token Balance
            </div>
            <p className="text-[0.85rem] text-star-white/30">No tokens found</p>
            <Link href="/faucet" className="mt-2 inline-block text-[0.8rem] text-nebula-purple underline underline-offset-4 transition-colors hover:text-solar-gold">
              Get devnet tokens
            </Link>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mb-8 flex gap-3">
        <Link
          href="/send"
          className="inline-flex h-9 items-center border border-solar-gold/30 bg-solar-gold/10 px-5 text-[0.75rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18"
        >
          Send Payment
        </Link>
        <Link
          href="/faucet"
          className="inline-flex h-9 items-center border border-nebula-purple/20 bg-nebula-purple/[0.04] px-5 text-[0.75rem] font-medium uppercase tracking-[0.15em] text-star-white/60 transition-all hover:border-nebula-purple/40 hover:text-star-white"
        >
          Request Faucet
        </Link>
      </div>

      {/* Recent transfers */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
            Recent Transfers
          </h2>
          <Link href="/transfers" className="text-[0.75rem] uppercase tracking-[0.15em] text-nebula-purple/60 transition-colors hover:text-solar-gold">
            View all &rarr;
          </Link>
        </div>

        {isLoadingTransfers ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse border border-nebula-purple/10 bg-nebula-purple/[0.03]" />
            ))}
          </div>
        ) : recentTransfers.length === 0 ? (
          <div className="border border-nebula-purple/15 bg-nebula-purple/[0.04] p-8 text-center">
            <p className="text-[0.85rem] text-star-white/40">No transfers yet. Send your first payment!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentTransfers.map((transfer) => (
              <Link key={transfer.transferPda} href={`/transfers/${transfer.transferPda}`}>
                <div className="group flex items-center justify-between border border-nebula-purple/15 bg-nebula-purple/[0.03] p-4 transition-all hover:border-solar-gold/30 hover:shadow-[0_0_20px_rgba(168,85,247,0.06)]">
                  <div className="flex items-center gap-4">
                    <div className="flex h-8 w-8 items-center justify-center border border-nebula-purple/20 bg-nebula-purple/[0.06] text-[0.85rem]">
                      {transfer.sender === publicKey?.toBase58() ? '↗' : '↙'}
                    </div>
                    <div>
                      <p className="text-[0.8rem] text-star-white">
                        {transfer.sender === publicKey?.toBase58() ? 'Sent' : 'Received'}
                        <span className="ml-2 text-star-white/30">
                          {transfer.sender === publicKey?.toBase58()
                            ? `to ${transfer.recipient.slice(0, 4)}...${transfer.recipient.slice(-4)}`
                            : `from ${transfer.sender.slice(0, 4)}...${transfer.sender.slice(-4)}`}
                        </span>
                      </p>
                      <p className="text-[0.7rem] text-star-white/25">
                        {transfer.memo || transfer.transferPda.slice(0, 8) + '...'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.85rem] font-medium text-star-white">
                      {transfer.amount} {transfer.token.symbol}
                    </p>
                    <StatusBadge status={transfer.status} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: 'text-solar-gold border-solar-gold/20',
    CLAIMED: 'text-nebula-purple border-nebula-purple/20',
    CANCELLED: 'text-star-white/40 border-star-white/10',
    EXPIRED: 'text-solar-orange border-solar-orange/20',
  };
  return (
    <span className={`inline-block border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.15em] ${colors[status] || colors.CANCELLED}`}>
      {status}
    </span>
  );
}
