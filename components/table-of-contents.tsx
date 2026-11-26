"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { TocItem } from "@/lib/posts";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * 목차. 읽는 위치에 따라 지금 보고 있는 절을 표시한다.
 * 항목마다 번호를 붙여 본문 인덱스와 같은 리듬을 준다.
 * 좁은 화면에서는 접었다 펼 수 있는 상자로 바뀐다.
 */
export function TableOfContents({
  items,
  variant = "sidebar",
}: {
  items: TocItem[];
  variant?: "sidebar" | "inline";
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<string>(items[0]?.id ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (items.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = 140;
      let current = items[0].id;
      for (const item of items) {
        const element = document.getElementById(item.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top - offset <= 0) {
          current = item.id;
        }
      }
      setActive(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  if (items.length < 2) return null;

  const list = (
    <ol className="mt-3">
      {items.map((item, index) => {
        const isActive = active === item.id;
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={isActive ? "true" : undefined}
              onClick={() => setOpen(false)}
              className={[
                "relative flex gap-2 py-1.5 pr-2 text-[12px] leading-[1.55] transition-colors duration-200",
                item.level === 3 ? "pl-10" : "pl-5",
                isActive ? "text-ink" : "text-ink-mute hover:text-ink-soft",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-px bg-rule"
              />
              {isActive ? (
                <motion.span
                  layoutId={variant === "sidebar" ? "toc-marker" : "toc-marker-inline"}
                  className="absolute inset-y-0 left-0 w-px bg-signal"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 520, damping: 42 }
                  }
                />
              ) : null}
              <span
                aria-hidden="true"
                className="shrink-0 font-mono text-[9px] leading-[1.9] tabular-nums tracking-[0.04em] text-ink-mute/70"
              >
                {pad(index + 1)}
              </span>
              <span className={isActive ? "font-medium" : ""}>{item.text}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );

  if (variant === "inline") {
    return (
      <div className="border border-rule bg-surface">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex min-w-0 items-baseline gap-2.5">
            <span className="label-mono shrink-0 text-ink-mute">목차</span>
            <span className="truncate text-[12.5px] font-medium text-ink">
              {items.find((item) => item.id === active)?.text ?? items[0].text}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-mute transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            strokeWidth={1.8}
          />
        </button>

        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="panel"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t border-rule px-4 pb-3">{list}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <nav aria-label="목차">
      <p className="label-mono text-ink-mute">목차</p>
      {list}
    </nav>
  );
}
