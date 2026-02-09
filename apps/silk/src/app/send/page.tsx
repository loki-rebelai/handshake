'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useConnectedWallet } from '@/hooks/useConnectedWallet';
import { useTransferActions } from '@/_jotai/transfer/transfer.actions';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';

interface Token {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
}

export default function SendPage() {
  const router = useRouter();
  const { publicKey, isConnected } = useConnectedWallet();
  const { createTransfer, signAndSubmit } = useTransferActions();

  const [tokens, setTokens] = useState<Token[]>([]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.get('/api/tokens').then((res) => {
      const tokenList = res.data.data.tokens;
      setTokens(tokenList);
      if (tokenList.length > 0) setSelectedToken(tokenList[0].symbol);
    }).catch(() => {});
  }, []);

  if (!isConnected) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[1200px] items-center justify-center px-8">
        <p className="text-[0.85rem] text-star-white/40">
          <Link href="/" className="text-solar-gold underline underline-offset-4 hover:text-solar-gold/80">Connect a wallet</Link> to send payments.
        </p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !recipient || !amount) return;

    setIsSubmitting(true);
    try {
      const { transaction, transferPda } = await createTransfer({
        sender: publicKey.toBase58(),
        recipient,
        amount: parseFloat(amount),
        token: selectedToken || undefined,
        memo: memo || undefined,
      });

      toast.info('Please approve the transaction in your wallet...');
      const txid = await signAndSubmit(transaction);
      toast.success(`Transfer created! TX: ${txid.slice(0, 8)}...`);
      router.push(`/transfers/${transferPda}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create transfer';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <div className="mb-8">
        <div className="text-[0.65rem] uppercase tracking-[0.3em] text-nebula-purple/60">New Transfer</div>
        <h1 className="font-display text-3xl font-black uppercase tracking-wide text-star-white">
          Send Payment
        </h1>
        <p className="mt-1 text-[0.85rem] italic text-star-white/40">
          Create an escrow transfer. Recipient claims, or you cancel.
        </p>
      </div>

      <div className="gradient-border-top border border-nebula-purple/20 p-6" style={{ background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.04) 0%, rgba(12, 0, 21, 0.8) 100%)' }}>
        <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
          Transfer Details
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="recipient" className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
              Recipient Address
            </label>
            <input
              id="recipient"
              placeholder="Solana wallet address..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full border border-nebula-purple/20 bg-deep-space/80 px-3 py-2.5 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="amount" className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
                Amount
              </label>
              <input
                id="amount"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-nebula-purple/20 bg-deep-space/80 px-3 py-2.5 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
                Token
              </label>
              <select
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
                className="w-full border border-nebula-purple/20 bg-deep-space/80 px-3 py-2.5 text-[0.8rem] text-star-white transition-colors focus:border-solar-gold/30 focus:outline-none"
              >
                {tokens.map((token) => (
                  <option key={token.symbol} value={token.symbol}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="memo" className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
              Memo <span className="normal-case tracking-normal text-star-white/25">(optional)</span>
            </label>
            <input
              id="memo"
              placeholder="What's this payment for?"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full border border-nebula-purple/20 bg-deep-space/80 px-3 py-2.5 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
            />
          </div>

          <div className="border-l-2 border-solar-gold bg-solar-gold/[0.04] p-4">
            <p className="text-[0.8rem] text-star-white/50">
              <strong className="text-solar-gold">Escrow</strong> — Funds held until the recipient claims. You can cancel and reclaim anytime before claim.
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !recipient || !amount}
            className="h-10 w-full border border-solar-gold/30 bg-solar-gold/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18 hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] disabled:opacity-30 disabled:hover:shadow-none"
          >
            {isSubmitting ? 'Signing...' : 'Send Payment'}
          </button>
        </form>
      </div>
    </div>
  );
}
