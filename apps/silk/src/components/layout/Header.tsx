'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { useConnectedWallet } from '@/hooks/useConnectedWallet';

const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const NAV_LINKS = [
  { href: '/send', label: 'Send' },
  { href: '/transfers', label: 'Transfers' },
  { href: '/faucet', label: 'Faucet' },
];

export function Header() {
  const pathname = usePathname();
  const { isConnected } = useConnectedWallet();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-nebula-purple/15 bg-deep-space/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-8">
        <div className="flex items-center gap-10">
          <Link href="/" className="group flex items-center gap-2">
            <span className="font-display text-lg font-black uppercase tracking-wide bg-gradient-to-r from-solar-gold via-solar-orange to-nebula-purple bg-clip-text text-transparent">
              Silkyway
            </span>
          </Link>

          {isConnected && (
            <nav className="hidden items-center gap-0.5 md:flex">
              {NAV_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'px-3 py-1.5 text-[0.7rem] font-medium uppercase tracking-[0.2em] transition-all duration-300',
                    pathname === href || pathname?.startsWith(href + '/')
                      ? 'text-solar-gold'
                      : 'text-star-white/40 hover:text-solar-gold/70',
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <div className="wallet-adapter-override">
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
