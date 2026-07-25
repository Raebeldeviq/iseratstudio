import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fabian&Pascal Inseratestudio",
  description:
    "Lokale Haustyp-Verwaltung, Inseratserstellung und kontrollierter Immoprofessional-Import.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
