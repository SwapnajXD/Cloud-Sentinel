import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "Cloud-Sentinel",
  description: "Standing watch over your AWS perimeter.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-ink text-mist">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
