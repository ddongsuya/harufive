import type { ReactNode } from "react";
import { Info, Lightbulb, TriangleAlert } from "lucide-react";

type CalloutProps = {
  type?: "tip" | "note" | "warn";
  title?: string;
  children: ReactNode;
};

const styles = {
  tip: {
    accent: "border-l-jade",
    icon: "text-jade",
    label: "요령",
    Icon: Lightbulb,
  },
  note: {
    accent: "border-l-indigo",
    icon: "text-indigo",
    label: "참고",
    Icon: Info,
  },
  warn: {
    accent: "border-l-signal",
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
    <div
      className={`my-7 border border-l-2 border-rule bg-surface/70 px-4 py-3.5 sm:px-5 ${style.accent}`}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] ${style.icon}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {style.label}
        </span>
        {title ? (
          <span className="text-[13px] font-semibold text-ink">{title}</span>
        ) : null}
      </p>
      <div className="mt-2 text-[0.925rem] leading-[1.85] text-ink-soft [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}
