import type { Metadata } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fabian-pascal-inseratstudio.ritter-fabian.chatgpt.site"),
  title: "Inserate Studio",
  description:
    "Objektverwaltung, Inseratserstellung, Exposés und standardisierte OpenImmo-Exporte.",
  openGraph: {
    title: "Inserate Studio",
    description: "Objekte. Klar organisiert.",
    images: [{ url: "/og.png", width: 1732, height: 908, alt: "Inserate Studio" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Inserate Studio",
    description: "Objekte. Klar organisiert.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body
        className={`${manrope.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
