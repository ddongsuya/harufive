import type { NextConfig } from "next";

/**
 * harufive.kr 정적 블로그 설정.
 *
 * `output: "export"` 로 빌드하면 `out/` 에 순수 정적 파일이 생성됩니다.
 * GitHub Pages / Cloudflare 정적 호스팅 어디서든 그대로 올릴 수 있습니다.
 * (정적 호스팅이므로 서버 액션·ISR·headers() 는 사용하지 않습니다.)
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  images: {
    // next/image 최적화 서버가 없으므로 원본 이미지를 그대로 사용합니다.
    unoptimized: true,
  },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
