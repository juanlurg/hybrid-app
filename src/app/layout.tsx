import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
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
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#111110",
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
    <html lang="es" className={`${archivo.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
