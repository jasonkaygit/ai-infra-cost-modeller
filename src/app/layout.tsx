import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice AI Cost & ROI Model",
  description:
    "Total cost of ownership, unit economics and ROI modelling for large-scale contact-centre Voice AI deployments.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-ground text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
