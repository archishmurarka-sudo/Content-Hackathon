import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mosaic Creator Engine",
  description: "BOF video briefs, pegged to each creator's voice and best-performing pattern.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
