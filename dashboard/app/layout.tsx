import type { Metadata } from 'next';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
export const metadata: Metadata = { title: { default: 'CloudSentinel · Security Operations', template: '%s · CloudSentinel' }, description: 'Evidence-driven AWS security assessment for your infrastructure.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>; }
