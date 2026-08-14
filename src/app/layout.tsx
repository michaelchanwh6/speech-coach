import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Presence — AI speaking coach",
  description:
    "Practice speeches and pitches. Get instant, specific feedback on your pace, filler words, expression, and gestures.",
};

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 shadow-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <g stroke="white" strokeWidth="2.1" strokeLinecap="round">
            <line x1="5" y1="9" x2="5" y2="15" />
            <line x1="9.5" y1="5" x2="9.5" y2="19" />
            <line x1="14.5" y1="7.5" x2="14.5" y2="16.5" />
            <line x1="19" y1="10.5" x2="19" y2="13.5" />
          </g>
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Presence</span>
    </Link>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_50%_at_50%_-10%,color-mix(in_oklab,var(--accent)_18%,transparent),transparent)]"
        />
        <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/70 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3.5">
            <Wordmark />
            <span className="hidden text-xs font-medium text-muted sm:block">
              AI speaking &amp; pitch coach
            </span>
          </div>
        </header>

        {children}

        <footer className="border-t border-line/70 py-6 text-center text-xs text-muted">
          Voice transcribed for analysis · video analyzed on-device · nothing stored
        </footer>
      </body>
    </html>
  );
}
