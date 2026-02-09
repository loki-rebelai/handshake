'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useConnectedWallet } from '@/hooks/useConnectedWallet';
import { useTransferActions } from '@/_jotai/transfer/transfer.actions';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';
import type { TransferInfo } from '@silkyway/sdk/dist/transfers.js';

export default function TransferDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pda = params.pda as string;
  const { publicKey, isConnected } = useConnectedWallet();
  const { claimTransfer, cancelTransfer, signAndSubmit } = useTransferActions();

  const [transfer, setTransfer] = useState<TransferInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'claim' | 'cancel' | null>(null);

  const fetchTransfer = useCallback(async () => {
    try {
      const res = await api.get(`/api/transfers/${pda}`);
      setTransfer(res.data.data.transfer);
    } catch {
      toast.error('Transfer not found');
    } finally {
      setIsLoading(false);
    }
  }, [pda]);

  useEffect(() => {
    fetchTransfer();
  }, [fetchTransfer]);

  const handleClaim = async () => {
    if (!publicKey || !transfer) return;
    setActionLoading('claim');
    try {
      const { transaction } = await claimTransfer(publicKey.toBase58(), transfer.transferPda);
      toast.info('Please approve the transaction in your wallet...');
      const txid = await signAndSubmit(transaction);
      toast.success(`Transfer claimed! TX: ${txid.slice(0, 8)}...`);
      fetchTransfer();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to claim transfer';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!publicKey || !transfer) return;
    setActionLoading('cancel');
    try {
      const { transaction } = await cancelTransfer(publicKey.toBase58(), transfer.transferPda);
      toast.info('Please approve the transaction in your wallet...');
      const txid = await signAndSubmit(transaction);
      toast.success(`Transfer cancelled! TX: ${txid.slice(0, 8)}...`);
      fetchTransfer();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to cancel transfer';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-10">
        <div className="space-y-4">
          <div className="h-8 w-48 animate-pulse bg-nebula-purple/10" />
          <div className="h-64 animate-pulse border border-nebula-purple/10 bg-nebula-purple/[0.03]" />
        </div>
      </div>
    );
  }

  if (!transfer) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[1200px] flex-col items-center justify-center px-8">
        <div className="border border-nebula-purple/20 bg-nebula-purple/[0.04] p-12 text-center">
          <h2 className="font-display text-2xl font-black uppercase tracking-wide text-star-white">Not Found</h2>
          <p className="mt-2 text-[0.85rem] text-star-white/50">This transfer does not exist or has been removed.</p>
          <Link href="/transfers" className="mt-4 inline-block text-[0.8rem] text-nebula-purple underline underline-offset-4 transition-colors hover:text-solar-gold">
            Back to transfers
          </Link>
        </div>
      </div>
    );
  }

  const walletAddress = publicKey?.toBase58();
  const isSender = transfer.sender === walletAddress;
  const isRecipient = transfer.recipient === walletAddress;
  const isActive = transfer.status === 'ACTIVE';
  const canClaim = isRecipient && isActive;
  const canCancel = isSender && isActive;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <button
        onClick={() => router.back()}
        className="mb-6 flex items-center gap-1 text-[0.75rem] uppercase tracking-[0.15em] text-nebula-purple/60 transition-colors hover:text-solar-gold"
      >
        ‹ Back
      </button>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="text-[0.65rem] uppercase tracking-[0.3em] text-nebula-purple/60">
            {isSender ? 'Sent Transfer' : isRecipient ? 'Received Transfer' : 'Transfer Detail'}
          </div>
          <h1 className="font-display text-4xl font-black text-star-white">
            {transfer.amount} {transfer.token.symbol}
          </h1>
        </div>
        <StatusBadge status={transfer.status} />
      </div>

      {/* Details */}
      <div className="gradient-border-top mb-6 border border-nebula-purple/20 p-6" style={{ background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.04) 0%, rgba(12, 0, 21, 0.8) 100%)' }}>
        <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
          Details
        </h2>
        <div className="space-y-3">
          <DetailRow label="Transfer PDA" value={transfer.transferPda} highlight={false} />
          <DetailRow label="Sender" value={transfer.sender} highlight={isSender} />
          <DetailRow label="Recipient" value={transfer.recipient} highlight={isRecipient} />
          <DetailRow label="Amount" value={`${transfer.amount} ${transfer.token.symbol}`} highlight={false} />
          <DetailRow label="Token" value={`${transfer.token.name} (${transfer.token.symbol})`} highlight={false} />
          {transfer.memo && <DetailRow label="Memo" value={transfer.memo} highlight={false} />}
          <DetailRow label="Created" value={new Date(transfer.createdAt).toLocaleString()} highlight={false} />
          {transfer.claimableAfter && (
            <DetailRow label="Claimable After" value={new Date(transfer.claimableAfter).toLocaleString()} highlight={false} />
          )}
          {transfer.claimableUntil && (
            <DetailRow label="Claimable Until" value={new Date(transfer.claimableUntil).toLocaleString()} highlight={false} />
          )}
        </div>
      </div>

      {/* Transactions */}
      <div className="mb-6 border border-nebula-purple/20 p-6" style={{ background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.04) 0%, rgba(12, 0, 21, 0.8) 100%)' }}>
        <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
          Transactions
        </h2>
        <div className="space-y-3">
          <TxLink label="Create TX" txid={transfer.createTxid} />
          {transfer.claimTxid && <TxLink label="Claim TX" txid={transfer.claimTxid} />}
          {transfer.cancelTxid && <TxLink label="Cancel TX" txid={transfer.cancelTxid} />}
        </div>
      </div>

      {/* Actions */}
      {isConnected && isActive && (canClaim || canCancel) && (
        <div className="flex gap-3">
          {canClaim && (
            <button
              onClick={handleClaim}
              disabled={actionLoading !== null}
              className="h-10 flex-1 border border-solar-gold/30 bg-solar-gold/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18 hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] disabled:opacity-30"
            >
              {actionLoading === 'claim' ? 'Signing...' : 'Claim Transfer'}
            </button>
          )}
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={actionLoading !== null}
              className="h-10 flex-1 border border-nebula-purple/20 bg-nebula-purple/[0.04] text-[0.8rem] font-medium uppercase tracking-[0.15em] text-star-white/60 transition-all hover:border-nebula-purple/40 hover:text-star-white disabled:opacity-30"
            >
              {actionLoading === 'cancel' ? 'Signing...' : 'Cancel Transfer'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[0.75rem] uppercase tracking-[0.1em] text-star-white/30">{label}</span>
      <span className={`text-right text-[0.75rem] break-all ${highlight ? 'text-solar-gold' : 'text-star-white/70'}`}>
        {value}
      </span>
    </div>
  );
}

function TxLink({ label, txid }: { label: string; txid: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[0.75rem] uppercase tracking-[0.1em] text-star-white/30">{label}</span>
      <a
        href={`https://solscan.io/tx/${txid}?cluster=devnet`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[0.75rem] text-nebula-purple underline underline-offset-4 transition-colors hover:text-solar-gold"
      >
        {txid.slice(0, 8)}...{txid.slice(-8)}
      </a>
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
    <span className={`inline-block border px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] ${colors[status] || colors.CANCELLED}`}>
      {status}
    </span>
  );
}
