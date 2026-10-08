import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'VA Launchpad',
  description: 'Pagsasanay para sa mga social media manager.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tl">
      <body>{children}</body>
    </html>
  );
}
