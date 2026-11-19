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

/** 카테고리를 점 + 이름으로 표시한다. 색은 카테고리를 가리키는 표식이다. */
export function CategoryChip({ category, asLink = false, className = "" }: Props) {
  const meta = categories.find((item) => item.slug === category);
  const name = meta?.name ?? category;
  const style = toneStyles[categoryTone(category)];

  const body = (
    <span
      className={[
        "inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-tight",
        style.text,
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.solid}`} />
      {name}
    </span>
  );

  if (!asLink) return body;

  return (
    <Link href={categoryPath(category)} className="group/chip inline-flex">
      {body}
    </Link>
  );
}
