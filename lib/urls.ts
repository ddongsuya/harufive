import { site } from "./site";

/**
 * URL·날짜처럼 서버 파일 접근이 필요 없는 계산만 모아 둔다.
 * 클라이언트 컴포넌트가 이 모듈을 가져다 쓸 수 있어야 한다.
 */

export function postPath(slug: string): string {
  return `/posts/${slug}/`;
}

export function categoryPath(slug: string): string {
  return `/categories/${slug}/`;
}

/** 태그를 URL 에 쓸 수 있는 형태로 바꾼다. (공백·기호 → 하이픈) */
export function tagSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function tagPath(tag: string): string {
  return `/tags/${encodeURIComponent(tagSlug(tag))}/`;
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

/** RSS·사이트맵에서 쓰는 절대 URL */
export function absoluteUrl(pathname: string): string {
  return `${site.url}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
