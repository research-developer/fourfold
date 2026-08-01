import type { Metadata } from "next";
import { Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "FOURFOLD — a symmetry-claiming game on the V₄ XOR Sierpiński figure",
  description:
    "Two players claim mirror symmetries on a Galois-coloured Sierpiński triangle. The vertical axis always works; the two diagonals only work for a third of the board — and finding out which third is the game.",
  openGraph: {
    title: "FOURFOLD",
    description:
      "Claim symmetries on a Galois-coloured Sierpiński triangle. Two axes are earned, one is free.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
