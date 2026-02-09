'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useAtomValue } from 'jotai';
import { useConnectedWallet } from '@/hooks/useConnectedWallet';
import { useTransferActions } from '@/_jotai/transfer/transfer.actions';
import { transfersAtom, isLoadingTransfersAtom } from '@/_jotai/transfer/transfer.state';

export default function TransfersPage() {
  const { publicKey, isConnected } = useConnectedWallet();
  const { fetchTransfers } = useTransferActions();
  const transfers = useAtomValue(transfersAtom);
  const isLoading = useAtomValue(isLoadingTransfersAtom);

  useEffect(() => {
    if (publicKey) {
      fetchTransfers(publicKey.toBase58());
    }
  }, [publicKey, fetchTransfers]);

  if (!isConnected) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[1200px] items-center justify-center px-8">
        <p className="text-[0.85rem] text-star-white/40">
          <Link href="/" className="text-solar-gold underline underline-offset-4 hover:text-solar-gold/80">Connect a wallet</Link> to view your transfers.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="text-[0.65rem] uppercase tracking-[0.3em] text-nebula-purple/60">History</div>
          <h1 className="font-display text-3xl font-black uppercase tracking-wide text-star-white">
            Transfers
          </h1>
          <p className="mt-1 text-[0.85rem] italic text-star-white/40">
            All transfers sent or received by your wallet.
          </p>
        </div>
        <Link
          href="/send"
          className="inline-flex h-9 items-center border border-solar-gold/30 bg-solar-gold/10 px-5 text-[0.75rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18"
        >
          New Transfer
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[68px] animate-pulse border border-nebula-purple/10 bg-nebula-purple/[0.03]" />
          ))}
        </div>
      ) : transfers.length === 0 ? (
        <div className="border border-nebula-purple/15 bg-nebula-purple/[0.04] p-12 text-center">
          <p className="text-star-white/40">No transfers found for this wallet.</p>
          <Link href="/send" className="mt-3 inline-block text-[0.8rem] text-nebula-purple underline underline-offset-4 transition-colors hover:text-solar-gold">
            Create your first transfer
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {transfers.map((transfer) => {
            const isSender = transfer.sender === publicKey?.toBase58();
            return (
              <Link key={transfer.transferPda} href={`/transfers/${transfer.transferPda}`}>
                <div className="group flex items-center justify-between border border-nebula-purple/15 bg-nebula-purple/[0.03] p-4 transition-all hover:border-solar-gold/30 hover:shadow-[0_0_20px_rgba(168,85,247,0.06)]">
                  <div className="flex items-center gap-4">
                    <div className="flex h-8 w-8 items-center justify-center border border-nebula-purple/20 bg-nebula-purple/[0.06] text-[0.85rem]">
                      {isSender ? '↗' : '↙'}
                    </div>
                    <div>
                      <p className="text-[0.8rem] text-star-white">
                        {isSender ? 'Sent' : 'Received'}
                        <span className="ml-2 text-star-white/30">
                          {isSender
                            ? `to ${transfer.recipient.slice(0, 4)}...${transfer.recipient.slice(-4)}`
                            : `from ${transfer.sender.slice(0, 4)}...${transfer.sender.slice(-4)}`}
                        </span>
                      </p>
                      <p className="text-[0.7rem] text-star-white/25">
                        {transfer.memo || transfer.transferPda.slice(0, 12) + '...'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-[0.85rem] font-medium text-star-white">
                        {transfer.amount} {transfer.token.symbol}
                      </p>
                      <p className="text-[0.65rem] text-star-white/25">
                        {new Date(transfer.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusBadge status={transfer.status} />
                    <span className="text-star-white/15 transition-colors group-hover:text-star-white/40">›</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
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
