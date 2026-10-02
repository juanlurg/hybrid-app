import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import { THEME_SCRIPT } from "@/lib/theme";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bloques — entrenamiento híbrido",
  description:
    "Fuerza y carrera en el mismo plan. El motor calcula el peso; tú solo levantas.",
  applicationName: "Bloques",
  appleWebApp: {
    capable: true,
    title: "Bloques",
    // No black band at the top any more: let iOS tint the status bar from
    // `themeColor` instead of forcing white glyphs onto a light page.
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2e9e3" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The theme script stamps `data-theme` before hydration, which is
    // exactly the attribute mismatch React would otherwise shout about.
    <html
      lang="es"
      className={`${jakarta.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-bg text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
