import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";

// Old-style numerals for years and counts.
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "我的旅行地图",
  description: "上传订单截图，自动识别行程并展示在世界地图上",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`h-full antialiased ${fraunces.variable}`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
