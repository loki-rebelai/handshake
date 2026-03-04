import type { Metadata } from 'next';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './globals.css';
import JotaiProvider from '@/providers/JotaiProvider';
import { ClusterProvider } from '@/contexts/ClusterContext';
import { WalletContextProvider } from '@/providers/WalletProvider';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'SilkyWay — Escrow Payments on Solana',
  description: 'Send, claim, and manage escrow-based payments on Solana with SilkyWay.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anybody:wght@900&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <div className="nebula" />
        <div className="corona" />
        <JotaiProvider>
          <ClusterProvider>
          <WalletContextProvider>
            <div className="relative z-10 flex min-h-screen flex-col">
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <ToastContainer
              position="bottom-right"
              autoClose={5000}
              hideProgressBar={false}
              closeOnClick
              pauseOnHover
              theme="dark"
              toastStyle={{
                background: '#1a0a2e',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                borderRadius: '2px',
                fontFamily: '"DM Mono", monospace',
                fontSize: '0.8rem',
              }}
            />
          </WalletContextProvider>
          </ClusterProvider>
        </JotaiProvider>
      </body>
    </html>
  );
}
