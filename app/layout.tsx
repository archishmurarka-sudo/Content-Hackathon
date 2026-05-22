import "./globals.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/toast";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans-base", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono-base", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif-base",
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Shrooms · Creative Engine",
  description: "BOF video briefs, pegged to each creator's voice and best-performing pattern.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>
      <body>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
