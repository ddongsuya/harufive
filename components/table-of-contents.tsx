"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { TocItem } from "@/lib/posts";

/**
 * 목차. 읽는 위치에 따라 지금 보고 있는 절을 표시한다.
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
    <ol className="relative mt-3">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-rule" />
      {items.map((item) => {
        const isActive = active === item.id;
        return (
          <li key={item.id} className={item.level === 3 ? "pl-7" : "pl-4"}>
            <a
              href={`#${item.id}`}
              aria-current={isActive ? "true" : undefined}
              onClick={() => setOpen(false)}
              className={[
                "relative block py-1.5 pr-2 text-[12.5px] leading-[1.5] transition-colors duration-200",
                isActive ? "font-semibold text-ink" : "text-ink-mute hover:text-ink-soft",
              ].join(" ")}
            >
              {isActive ? (
                <motion.span
                  layoutId={variant === "sidebar" ? "toc-marker" : "toc-marker-inline"}
                  className="absolute -left-px top-0 h-full w-[2px] bg-signal"
                  transition={
                    reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }
                  }
                />
              ) : null}
              {item.text}
            </a>
          </li>
        );
      })}
    </ol>
  );

  if (variant === "inline") {
    return (
      <div className="rounded-xl border border-rule bg-surface">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-baseline gap-2">
            <span className="label-mono text-ink-mute">목차</span>
            <span className="truncate text-[13px] font-semibold text-ink">
              {items.find((item) => item.id === active)?.text ?? items[0].text}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-mute transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
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
              <div className="border-t border-rule/70 px-4 pb-3">{list}</div>
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
