import type { ReactNode } from "react";

type CalloutProps = {
  type?: "tip" | "note" | "warn";
  title?: string;
  children: ReactNode;
};

const styles: Record<
  NonNullable<CalloutProps["type"]>,
  { box: string; badge: string; label: string }
> = {
  tip: {
    box: "border-brand/30 bg-brand-soft/60",
    badge: "bg-brand text-white",
    label: "팁",
  },
  note: {
    box: "border-line bg-paper-alt",
    badge: "bg-ink-soft text-white",
    label: "참고",
  },
  warn: {
    box: "border-accent/35 bg-accent/8",
    badge: "bg-accent text-white",
    label: "주의",
  },
};

/** MDX 본문에서 쓰는 강조 박스: <Callout type="tip" title="...">내용</Callout> */
export function Callout({ type = "tip", title, children }: CalloutProps) {
  const style = styles[type];

  return (
    <div className={`my-7 rounded-xl border px-5 py-4 ${style.box}`}>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${style.badge}`}
        >
          {style.label}
        </span>
        {title}
      </p>
      <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-[0.95rem] leading-relaxed text-ink-soft">
        {children}
      </div>
    </div>
  );
}
