# 하루다섯 (harufive.kr)

AI 툴·자동화 & 생산성 가이드를 다루는 한국어 블로그입니다.
이전 '하루다섯' 게임 베타 앱을 대체하는 정적 블로그 버전입니다.

- 사이트: <https://harufive.kr>
- 호스팅: GitHub Pages (정적 파일)
- 프레임워크: Next.js App Router + `output: "export"`
- 콘텐츠: `content/posts/*.mdx` (MDX + GFM)
- 수익화: Google AdSense (승인 후 광고 ID 설정 시에만 렌더)

## 로컬 실행

```bash
npm ci
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # 정적 결과물 out/ 생성
```

`npm run dev` / `npm run build` 는 Node.js 20.9 이상이 필요합니다.

## 구조

```
app/
  page.tsx                      홈 (소개 + 최신 글 + 카테고리)
  posts/page.tsx                글 전체 목록
  posts/[slug]/page.tsx         글 상세 (목차·읽기시간·관련 글·JSON-LD)
  categories/[category]/page.tsx
  tags/[tag]/page.tsx
  about/ privacy/ terms/ contact/
  sitemap.ts  robots.ts  feed.xml/route.ts  not-found.tsx
content/posts/*.mdx             게시물 본문
lib/site.ts                     사이트 설정·카테고리
lib/posts.ts                    MDX 읽기, 목차, 읽기 시간, 관련 글
components/                     헤더·푸터·카드·광고 슬롯·목차
public/CNAME                    커스텀 도메인 (harufive.kr)
public/ads.txt                  애드센스 ads.txt (승인 후 활성화)
```

## 글 쓰기

`content/posts/` 에 `.mdx` 파일을 추가하면 빌드 시 자동으로 목록·사이트맵·태그 페이지에 반영됩니다.

```yaml
---
title: "글 제목"
description: "검색 결과와 목록에 노출될 1~2문장 요약"
date: 2026-11-19
category: "ai-basics"   # lib/site.ts 의 categories slug
tags: ["프롬프트", "자동화"]
draft: false            # true 면 production 빌드에서 제외
featured: false
---
```

본문은 일반 마크다운(GFM 표 지원)을 쓰고, 강조 박스가 필요하면 `<Callout type="tip" title="제목">내용</Callout>` 을 사용합니다.

## 환경변수

`.env.example` 참고. 모두 선택 사항이며, 없으면 광고가 렌더되지 않습니다.

| 변수 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | 사이트 절대 URL (기본 `https://harufive.kr`) |
| `NEXT_PUBLIC_ADSENSE_CLIENT` | `ca-pub-...` 애드센스 게시자 ID |
| `NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE` | 본문 광고 단위 ID |
| `NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR` | 사이드바 광고 단위 ID |
| `CONTACT_TO` | 문의 수신 메일 (기본 `limjm900202@gmail.com`) |

## 배포 (GitHub Pages)

`.github/workflows/deploy.yml` 이 두 가지를 수행합니다.

- **PR**: `npm ci` → `typecheck` → `build` 검증만 (배포 없음)
- **main push**: `out/` 을 GitHub Pages 아티팩트로 업로드 후 배포

최초 1회 저장소 설정이 필요합니다.

1. **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 변경
2. **Custom domain** 에 `harufive.kr` 입력 후 저장 (저장소의 `public/CNAME` 과 동일)
3. DNS(가비아)에서 `harufive.kr` → `ddongsuya.github.io` 로 향하는 레코드 설정
   - apex 도메인은 A 레코드 4개(185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153) 또는 ALIAS/ANAME
   - `www` 를 쓰려면 `www` → `ddongsuya.github.io` CNAME
4. **Enforce HTTPS** 체크 (인증서 발급까지 시간이 걸릴 수 있음)

> GitHub Pages 를 **비공개(private) 저장소**에서 쓰려면 GitHub Pro 이상이 필요합니다. 무료 계정으로 운영하려면 저장소를 Public 으로 전환해야 하며, 전환 시 이전 커밋 이력과 코드도 공개됩니다. (기존 베타 코드는 태그 `haru-five-beta-2026-10-21` 로 보존되어 있습니다.)

## 애드센스 승인 후 할 일

1. `NEXT_PUBLIC_ADSENSE_CLIENT`, 슬롯 ID 를 저장소 **Settings → Secrets and variables → Actions → Variables** 에 추가하거나 워크플로우 `env` 로 주입
2. `public/ads.txt` 의 주석을 풀고 실제 `pub-` ID 입력
3. 재배포 후 `/ads.txt`, 광고 영역 표시 확인

> 승인 전에는 `public/ads.txt` 에 유효한 레코드가 없습니다. 애드센스에서 ads.txt 경고가 보이면 승인 전까지 파일을 비워 두거나 삭제해도 됩니다.
