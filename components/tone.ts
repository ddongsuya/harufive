import type { CategoryTone } from "@/lib/site";

type ToneStyle = {
  /** 채워진 배지·점 */
  solid: string;
  /** 옅은 배경 */
  soft: string;
  /** 글자색 */
  text: string;
  /** 테두리 */
  border: string;
  /** 장식 선 */
  line: string;
};

/**
 * 카테고리 색은 장식이 아니라 정보다.
 * 같은 값이 칩·점·테두리에서 같은 뜻으로 쓰이도록 한 곳에 모아 둔다.
 */
export const toneStyles: Record<CategoryTone, ToneStyle> = {
  indigo: {
    solid: "bg-indigo",
    soft: "bg-indigo/10",
    text: "text-indigo",
    border: "border-indigo/35",
    line: "bg-indigo",
  },
  signal: {
    solid: "bg-signal",
    soft: "bg-signal/10",
    text: "text-signal",
    border: "border-signal/35",
    line: "bg-signal",
  },
  jade: {
    solid: "bg-jade",
    soft: "bg-jade/10",
    text: "text-jade",
    border: "border-jade/35",
    line: "bg-jade",
  },
  clay: {
    solid: "bg-clay",
    soft: "bg-clay/10",
    text: "text-clay",
    border: "border-clay/35",
    line: "bg-clay",
  },
};

export function tone(toneName: CategoryTone): ToneStyle {
  return toneStyles[toneName];
}
