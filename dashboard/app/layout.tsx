import type { Metadata } from "next";
import { Syne, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// 1. Initialize the Google Fonts matching your CSS variables perfectly
const syne = Syne({
  weight: ["800"], // Force extra bold to trigger Syne's graphic stretch
  subsets: ["latin"],
  variable: "--font-artistic",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cloud Sentinel - Security Control Plane",
  description: "Enterprise Cloud Security Posture Management Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 2. Inject all three variables into the HTML class list so your CSS can access them
    <html 
      lang="en" 
      className={`${syne.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}