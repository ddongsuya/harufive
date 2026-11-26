import Link from "next/link";
import { categories, categoryTone } from "@/lib/site";
import { categoryPath } from "@/lib/urls";
import { toneStyles } from "./tone";

type Props = {
  category: string;
  /** 링크로 쓸지, 글자만 둘지 */
  asLink?: boolean;
  className?: string;
};

/**
 * 카테고리를 점 + 이름으로 표시한다.
 * 인덱스 행·상세 머리말·필터 칩이 같은 언어(점 + 작은 이름)를 쓰도록 맞춘다.
 */
export function CategoryChip({ category, asLink = false, className = "" }: Props) {
  const meta = categories.find((item) => item.slug === category);
  const name = meta?.name ?? category;
  const style = toneStyles[categoryTone(category)];

  const body = (
    <span
      className={[
        "inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-ink-soft transition-colors",
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" className={`h-1 w-1 rounded-full ${style.solid}`} />
      {name}
    </span>
  );

  if (!asLink) return body;

  return (
    <Link href={categoryPath(category)} className="inline-flex hover:text-ink">
      {body}
    </Link>
  );
}
