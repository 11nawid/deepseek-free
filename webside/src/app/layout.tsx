import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme-provider";
import TitleBar from "@/components/TitleBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeepSeek Free",
  description: "Free AI Chat with DeepSeek",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground h-screen w-screen overflow-hidden`}
      >
        <ThemeProvider>
          <TitleBar />
          <div className="relative h-full w-full bg-panel overflow-hidden flex pt-10">
            <div className="bg-grid-pattern absolute inset-0 pointer-events-none" />
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
