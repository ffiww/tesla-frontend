import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tesla 车况",
  description: "查看个人 Tesla 的电量、续航、充电状态与历史趋势。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
