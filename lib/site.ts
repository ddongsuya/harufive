/**
 * 사이트 전역 설정. 환경변수는 빌드 시점에 인라인되므로
 * GitHub Actions 에서 값을 넣으면 그대로 결과물에 반영된다.
 */

const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://harufive.kr";

export const site = {
  name: "하루다섯",
  latinName: "harufive",
  url: rawSiteUrl.replace(/\/+$/, ""),
  title: "하루다섯 · AI 툴·자동화 & 생산성 가이드",
  shortTitle: "하루다섯",
  description:
    "AI 툴과 자동화로 반복 업무를 줄이는 방법을 정리합니다. 프롬프트 설계, 노코드 자동화, 무료 AI 도구 조합까지 실무에서 바로 쓰는 가이드.",
  author: {
    name: "임정모",
    role: "운영자",
    bio: "AI 툴과 자동화로 하루의 반복 업무를 줄이는 방법을 실험하고 기록합니다.",
  },
  contactEmail: process.env.CONTACT_TO ?? "limjm900202@gmail.com",
  locale: "ko_KR",
  language: "ko",
  ogImage: "/og/default.png",
  adsense: {
    client: process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "",
    slotArticle: process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE ?? "",
    slotSidebar: process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR ?? "",
  },
  gaId: process.env.NEXT_PUBLIC_GA_ID ?? "",
} as const;

export type Category = {
  slug: string;
  name: string;
  description: string;
};

/** 카테고리는 이 목록만 쓴다. 글 frontmatter 의 category 값과 slug 가 일치해야 한다. */
export const categories: Category[] = [
  {
    slug: "ai-basics",
    name: "AI 기초",
    description:
      "챗봇과 AI 에이전트가 어떻게 다르고, 무엇을 맡길 수 있는지 정리한 글.",
  },
  {
    slug: "prompting",
    name: "프롬프트",
    description:
      "ChatGPT·Claude 같은 도구에서 원하는 결과를 안정적으로 얻는 지시문 설계법.",
  },
  {
    slug: "automation",
    name: "업무 자동화",
    description:
      "반복 업무를 찾아 없애는 순서, 노코드 도구로 만드는 실제 자동화 흐름.",
  },
  {
    slug: "tools",
    name: "툴 활용",
    description:
      "무료로 시작할 수 있는 AI 생산성 도구 조합과 각 도구의 실무 쓰임.",
  },
];

export function getCategory(slug: string): Category | undefined {
  return categories.find((category) => category.slug === slug);
}

export function categoryName(slug: string): string {
  return getCategory(slug)?.name ?? slug;
}
