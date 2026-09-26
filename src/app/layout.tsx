import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Fraunces: titles, wordmark and headline numbers (soft, optical sizing).
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
});

// IBM Plex Sans: all interface text.
const plexSans = IBM_Plex_Sans({
  variable: "--font-sans-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// IBM Plex Mono: tabular figures only (km, $, months).
const plexMono = IBM_Plex_Mono({
  variable: "--font-numbers",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const viewport: Viewport = {
  themeColor: "#f2eee6",
};

export const metadata: Metadata = {
  title: "MrGridy",
  description: "Where neighboring power companies' work collides, before they build and before the storm hits.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
