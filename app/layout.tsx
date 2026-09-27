import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { cn } from "@/lib/utils";

const jakarta = localFont({
  src: [
    { path: "../public/fonts/PlusJakartaSans-Variable.ttf", weight: "200 800", style: "normal" },
    { path: "../public/fonts/PlusJakartaSans-Italic-Variable.ttf", weight: "200 800", style: "italic" },
  ],
  variable: "--font-jakarta-local",
  display: "swap",
  adjustFontFallback: false,
});

const bengali = localFont({
  src: "../public/fonts/NotoSerifBengali-Variable.ttf",
  weight: "100 900",
  style: "normal",
  variable: "--font-bengali-local",
  display: "swap",
  adjustFontFallback: false,
  preload: false,
});

const hind = localFont({
  src: [
    { path: "../public/fonts/HindSiliguri-Light.ttf", weight: "300", style: "normal" },
    { path: "../public/fonts/HindSiliguri-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/HindSiliguri-Medium.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/HindSiliguri-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../public/fonts/HindSiliguri-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-hind-local",
  display: "swap",
  adjustFontFallback: false,
  preload: false,
});

const amiri = localFont({
  src: [
    { path: "../public/fonts/Amiri-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/Amiri-Bold.ttf", weight: "700", style: "normal" },
    { path: "../public/fonts/Amiri-Italic.ttf", weight: "400", style: "italic" },
  ],
  variable: "--font-amiri-local",
  display: "swap",
  adjustFontFallback: false,
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "InvestWise",
    template: "%s | InvestWise",
  },
  description: "Enterprise Investment Management Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(jakarta.variable, bengali.variable, hind.variable, amiri.variable, "font-sans")}
    >
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
