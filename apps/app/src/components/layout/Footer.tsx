import Link from 'next/link';

function RebelFiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 271 271"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M0 0L202.821 0.00113595L270.429 67.6085V135.216H202.822L270.429 202.822V270.43H137.868V133.196H0V0Z"
        fill="currentColor"
      />
      <path
        d="M0 156.509V270.429H111.355V156.509H0Z"
        fill="currentColor"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

const FOOTER_LINKS = [
  { label: 'App', href: '/account' },
  { label: 'Docs', href: 'https://docs.silkyway.io', external: true },
  { label: 'SDK', href: 'https://github.com/silkysquad/silk', external: true },
];

const SOCIAL_LINKS = [
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/rebelfi',
    icon: LinkedInIcon,
  },
  {
    label: 'X',
    href: 'https://x.com/rebelfi_io',
    icon: XIcon,
  },
];

export function Footer() {
  return (
    <footer className="relative z-10 mt-auto border-t border-nebula-purple/10">
      {/* Gradient line at top */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-solar-gold/30 to-transparent" />

      <div className="mx-auto max-w-[1200px] px-8 py-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: RebelFi brand */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <RebelFiMark className="h-4 w-4 text-solar-gold/70" />
              <span className="text-[0.75rem] uppercase tracking-[0.25em] text-star-white/30">
                A <a href="https://rebelfi.io" target="_blank" rel="noopener noreferrer" className="text-solar-gold/60 font-medium hover:text-solar-gold transition-colors duration-300">RebelFi</a> brand
              </span>
            </div>
            <p className="max-w-xs text-[0.7rem] leading-relaxed text-star-white/15">
              Agent banking infrastructure on Solana. Delegated control with spending limits.
            </p>
          </div>

          {/* Center: Links */}
          <nav className="flex items-center gap-6">
            {FOOTER_LINKS.map(({ label, href, external }) =>
              external ? (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[0.75rem] uppercase tracking-[0.2em] text-star-white/25 transition-colors duration-300 hover:text-solar-gold/60"
                >
                  {label}
                </a>
              ) : (
                <Link
                  key={label}
                  href={href}
                  className="text-[0.75rem] uppercase tracking-[0.2em] text-star-white/25 transition-colors duration-300 hover:text-solar-gold/60"
                >
                  {label}
                </Link>
              ),
            )}
          </nav>

          {/* Right: Social */}
          <div className="flex items-center gap-3">
            {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="group flex h-8 w-8 items-center justify-center border border-nebula-purple/15 bg-star-white/[0.02] transition-all duration-300 hover:border-solar-gold/30 hover:bg-solar-gold/[0.06]"
              >
                <Icon className="h-3.5 w-3.5 text-star-white/25 transition-colors duration-300 group-hover:text-solar-gold/70" />
              </a>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 flex flex-col gap-2 border-t border-nebula-purple/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[0.65rem] uppercase tracking-[0.2em] text-star-white/12">
            &copy; {new Date().getFullYear()} RebelFi
          </span>
          <span className="text-[0.65rem] tracking-[0.05em] text-star-white/10">
            Built on Solana
          </span>
        </div>
      </div>
    </footer>
  );
}
