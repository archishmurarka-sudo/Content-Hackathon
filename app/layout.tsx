import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Higgsfield Video Dashboard",
  description: "Generate and manage Higgsfield video jobs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
