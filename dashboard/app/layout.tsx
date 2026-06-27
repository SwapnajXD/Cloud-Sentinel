import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cloud Sentinel",
  description: "Cloud auditing dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        className="bg-[#0A2947] text-[#F3E4C9] antialiased"
      >
        {children}
      </body>
    </html>
  );
}