import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "하루다섯 — 매일 쌓이는 작은 성취",
  description: "매일 다섯 문제로 쌓는 나만의 기록. 여섯 분야의 퍼즐, 주간 등급, 귀여운 도트 캐릭터 꾸미기를 만나보세요.",
  icons: {
    icon: "/game/favicon.svg",
    shortcut: "/game/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7860b5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head><link rel="stylesheet" href="/game/styles.css?v=0.5.1" /></head>
      <body>{children}</body>
    </html>
  );
}
