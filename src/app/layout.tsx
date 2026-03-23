import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "PM Interview Toolbox",
  description:
    "明亮二次元风格的技术面试知识库，支持语法高亮、目录自动生成和 Markdown 动态渲染。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      style={{ colorScheme: "light" }}
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased light`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
