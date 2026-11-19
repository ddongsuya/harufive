import type { ReactNode } from "react";
import { Info, Lightbulb, TriangleAlert } from "lucide-react";

type CalloutProps = {
  type?: "tip" | "note" | "warn";
  title?: string;
  children: ReactNode;
};

const styles = {
  tip: {
    box: "border-jade/30 bg-jade/[0.055]",
    icon: "text-jade",
    label: "요령",
    Icon: Lightbulb,
  },
  note: {
    box: "border-indigo/25 bg-indigo/[0.05]",
    icon: "text-indigo",
    label: "참고",
    Icon: Info,
  },
  warn: {
    box: "border-signal/30 bg-signal/[0.06]",
    icon: "text-signal",
    label: "주의",
    Icon: TriangleAlert,
  },
} as const;

/** MDX 본문에서 쓰는 강조 상자: <Callout type="tip" title="...">내용</Callout> */
export function Callout({ type = "tip", title, children }: CalloutProps) {
  const style = styles[type];
  const Icon = style.Icon;

  return (
    <div className={`my-7 rounded-xl border px-5 py-4 ${style.box}`}>
      <p className="flex items-center gap-2 text-[13.5px] font-bold text-ink">
        <Icon className={`h-4 w-4 ${style.icon}`} strokeWidth={2} aria-hidden="true" />
        {title ?? style.label}
      </p>
      <div className="mt-2 text-[0.925rem] leading-[1.8] text-ink-soft [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}
