declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    HARU_AUTH_ORIGIN?: string;
    HARU_REGISTRATION_OPEN?: string;
    HARU_SITES_TESTER_EMAIL?: string;
    HARU_GOOGLE_CLIENT_ID?: string;
    HARU_GOOGLE_CLIENT_SECRET?: string;
    HARU_KAKAO_CLIENT_ID?: string;
    HARU_KAKAO_CLIENT_SECRET?: string;
    HARU_KAKAO_OIDC_ENABLED?: string;
    HARU_NAVER_CLIENT_ID?: string;
    HARU_NAVER_CLIENT_SECRET?: string;
  }
}
