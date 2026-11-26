"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Menu, Rss, X } from "lucide-react";
import { categories, categoryTone, site } from "@/lib/site";
import { categoryPath } from "@/lib/urls";
import { toneStyles } from "./tone";

const navItems = [
  { href: "/posts/", label: "가이드", match: ["/posts", "/categories", "/tags"] },
  { href: "/about/", label: "소개", match: ["/about"] },
  { href: "/contact/", label: "문의", match: ["/contact"] },
];

/** 다섯 칸을 닮은 눈금 표식 — 높이가 다른 세로선 다섯, 마지막 하나만 신호색. */
function LogoMark() {
  return (
    <span aria-hidden="true" className="flex h-4 items-end gap-[3px]">
      {["h-1.5", "h-2.5", "h-3", "h-3.5", "h-4"].map((height, index) => (
        <span
          key={height}
          className={`w-px ${height} ${index === 4 ? "bg-signal" : "bg-ink"}`}
        />
      ))}
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (match: string[]) =>
    match.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-rule bg-canvas/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-6 px-5 sm:px-8">
          <Link
            href="/"
            className="group flex items-baseline gap-2.5"
            aria-label={`${site.name} 홈`}
          >
            <LogoMark />
            <span className="font-editorial text-[18px] font-semibold tracking-[-0.02em] text-ink">
              {site.name}
            </span>
            <span className="hidden font-mono text-[10px] tracking-[0.08em] text-ink-mute sm:inline">
              harufive.kr
            </span>
          </Link>

          <nav aria-label="주요 메뉴" className="hidden items-center gap-7 sm:flex">
            {navItems.map((item) => {
              const active = isActive(item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "group/nav relative py-1 text-[12.5px] tracking-[0.01em] transition-colors",
                    active
                      ? "font-semibold text-ink"
                      : "font-medium text-ink-mute hover:text-ink",
                  ].join(" ")}
                >
                  {item.label}
                  <span
                    aria-hidden="true"
                    className={[
                      "absolute inset-x-0 -bottom-px h-px origin-left bg-ink transition-transform duration-300",
                      active
                        ? "scale-x-100"
                        : "scale-x-0 group-hover/nav:scale-x-100",
                    ].join(" ")}
                  />
                </Link>
              );
            })}

            <a
              href="/feed.xml"
              className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-rule text-ink-soft transition-colors hover:border-ink hover:text-ink"
              aria-label="RSS 피드"
            >
              <Rss className="h-3.5 w-3.5" strokeWidth={1.7} />
            </a>
          </nav>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rule text-ink sm:hidden"
            aria-label="메뉴 열기"
            aria-expanded={open}
          >
            <Menu className="h-5 w-5" strokeWidth={1.7} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="drawer"
            className="fixed inset-0 z-[60] flex flex-col bg-canvas sm:hidden"
            initial={{ opacity: 0, y: reduce ? 0 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -10 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex h-16 items-center justify-between border-b border-rule px-5">
              <span className="flex items-baseline gap-2.5">
                <LogoMark />
                <span className="font-editorial text-[18px] font-semibold tracking-[-0.02em]">
                  {site.name}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rule"
                aria-label="메뉴 닫기"
              >
                <X className="h-5 w-5" strokeWidth={1.7} />
              </button>
            </div>

            <nav aria-label="모바일 메뉴" className="flex-1 overflow-y-auto px-5 py-4">
              <ul className="border-t border-rule">
                {navItems.map((item, index) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-baseline justify-between gap-4 border-b border-rule py-4"
                    >
                      <span className="flex items-baseline gap-3">
                        <span className="font-mono text-[10px] tabular-nums text-ink-mute">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="font-editorial text-[22px] font-semibold tracking-[-0.02em] text-ink">
                          {item.label}
                        </span>
                      </span>
                      <ArrowUpRight
                        className="h-4 w-4 self-center text-ink-mute"
                        strokeWidth={1.6}
                      />
                    </Link>
                  </li>
                ))}
              </ul>

              <p className="label-mono mt-8 text-ink-mute">카테고리</p>
              <ul className="mt-2 border-t border-rule">
                {categories.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={categoryPath(category.slug)}
                      className="flex items-center gap-2.5 border-b border-rule py-3 text-[14px] text-ink-soft"
                    >
                      <span
                        aria-hidden="true"
                        className={`h-1 w-1 rounded-full ${toneStyles[categoryTone(category.slug)].solid}`}
                      />
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>

              <a
                href="/feed.xml"
                className="mt-8 inline-flex items-center gap-2 border-b border-ink pb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink"
              >
                <Rss className="h-3.5 w-3.5" strokeWidth={1.7} />
                RSS
              </a>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
