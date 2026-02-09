'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useConnectedWallet } from '@/hooks/useConnectedWallet';
import { useTransferActions } from '@/_jotai/transfer/transfer.actions';
import { useWalletActions } from '@/_jotai/wallet/wallet.actions';
import { toast } from 'react-toastify';

const FAUCET_OPTIONS = [
  { value: 'both', label: 'SOL + USDC', desc: 'Get both SOL and USDC' },
  { value: 'sol', label: 'SOL only', desc: 'Get devnet SOL for gas fees' },
  { value: 'usdc', label: 'USDC only', desc: 'Get devnet USDC for transfers' },
];

export default function FaucetPage() {
  const { publicKey, isConnected } = useConnectedWallet();
  const { requestFaucet } = useTransferActions();
  const { fetchBalance } = useWalletActions();
  const [selected, setSelected] = useState('both');
  const [isRequesting, setIsRequesting] = useState(false);

  if (!isConnected) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[1200px] items-center justify-center px-8">
        <p className="text-[0.85rem] text-star-white/40">
          <Link href="/" className="text-solar-gold underline underline-offset-4 hover:text-solar-gold/80">Connect a wallet</Link> to use the faucet.
        </p>
      </div>
    );
  }

  const handleRequest = async () => {
    if (!publicKey) return;
    setIsRequesting(true);
    try {
      await requestFaucet(publicKey.toBase58(), selected);
      toast.success('Faucet tokens received!');
      fetchBalance(publicKey.toBase58());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Faucet request failed';
      toast.error(message);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <div className="mb-8">
        <div className="text-[0.65rem] uppercase tracking-[0.3em] text-nebula-purple/60">Devnet</div>
        <h1 className="font-display text-3xl font-black uppercase tracking-wide text-star-white">
          Faucet
        </h1>
        <p className="mt-1 text-[0.85rem] italic text-star-white/40">
          Request free devnet tokens to test Silkyway transfers.
        </p>
      </div>

      <div className="gradient-border-top border border-nebula-purple/20 p-6" style={{ background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.04) 0%, rgba(12, 0, 21, 0.8) 100%)' }}>
        <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
          Request Tokens
        </h2>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <div className="text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">Receiving Wallet</div>
            <div className="border border-nebula-purple/15 bg-deep-space/80 px-3 py-2.5">
              <p className="text-[0.75rem] text-star-white/50">{publicKey?.toBase58()}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">Select Tokens</div>
            <div className="space-y-2">
              {FAUCET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSelected(option.value)}
                  className={`flex w-full items-center gap-3 border p-4 text-left transition-all ${
                    selected === option.value
                      ? 'border-solar-gold/30 bg-solar-gold/[0.06]'
                      : 'border-nebula-purple/15 bg-nebula-purple/[0.03] hover:border-nebula-purple/30'
                  }`}
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center border transition-colors ${
                      selected === option.value ? 'border-solar-gold bg-solar-gold' : 'border-star-white/20'
                    }`}
                  >
                    {selected === option.value && (
                      <span className="text-[0.6rem] text-deep-space">✓</span>
                    )}
                  </div>
                  <div>
                    <p className="text-[0.8rem] text-star-white">{option.label}</p>
                    <p className="text-[0.7rem] text-star-white/30">{option.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleRequest}
            disabled={isRequesting}
            className="h-10 w-full border border-solar-gold/30 bg-solar-gold/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18 hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] disabled:opacity-30 disabled:hover:shadow-none"
          >
            {isRequesting ? 'Requesting...' : 'Request Tokens'}
          </button>

          <div className="border-l-2 border-nebula-purple bg-nebula-purple/[0.04] p-4">
            <p className="text-[0.8rem] text-star-white/40">
              This faucet provides devnet tokens for testing only. Tokens have no real value. Rate limits may apply.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
