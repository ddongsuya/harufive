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

/** 하루 다섯 칸을 닮은 표식 — 네 칸과 세로로 긴 한 칸. */
function LogoMark() {
  return (
    <span aria-hidden="true" className="grid h-7 w-7 grid-cols-3 grid-rows-2 gap-[2px]">
      <span className="rounded-[1px] bg-ink" />
      <span className="rounded-[1px] bg-ink" />
      <span className="row-span-2 rounded-[1px] bg-signal" />
      <span className="rounded-[1px] bg-ink" />
      <span className="rounded-[1px] bg-ink" />
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
    match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  return (
    <>
      <header
        className={[
          "sticky top-0 z-50 border-b transition-colors duration-300",
          scrolled
            ? "border-rule bg-canvas shadow-[0_1px_0_0_rgba(16,20,19,0.04)]"
            : "border-transparent bg-canvas",
        ].join(" ")}
      >
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-6 px-5 sm:px-8">
          <Link href="/" className="group flex items-center gap-2.5" aria-label={`${site.name} 홈`}>
            <LogoMark />
            <span className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold tracking-tight text-ink">{site.name}</span>
              <span className="font-display hidden text-[12.5px] font-medium tracking-[0.02em] text-ink-mute sm:inline">
                {site.latinName}.kr
              </span>
            </span>
          </Link>

          <nav aria-label="주요 메뉴" className="hidden items-center gap-1 sm:flex">
            {navItems.map((item) => {
              const active = isActive(item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="relative rounded-full px-3.5 py-2 text-[13.5px] font-semibold text-ink-soft transition-colors hover:text-ink"
                >
                  {active ? (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-ink"
                      transition={
                        reduce
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 420, damping: 34 }
                      }
                    />
                  ) : null}
                  <span className={active ? "relative text-surface" : "relative"}>
                    {item.label}
                  </span>
                </Link>
              );
            })}

            <a
              href="/feed.xml"
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-rule text-ink-soft transition-colors hover:border-ink hover:text-ink"
              aria-label="RSS 피드"
            >
              <Rss className="h-4 w-4" strokeWidth={1.8} />
            </a>
          </nav>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rule text-ink sm:hidden"
            aria-label="메뉴 열기"
            aria-expanded={open}
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="drawer"
            className="fixed inset-0 z-[60] flex flex-col bg-canvas sm:hidden"
            initial={{ opacity: 0, y: reduce ? 0 : -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -12 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex h-16 items-center justify-between border-b border-rule px-5">
              <span className="flex items-center gap-2.5">
                <LogoMark />
                <span className="text-[17px] font-bold tracking-tight">{site.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rule"
                aria-label="메뉴 닫기"
              >
                <X className="h-5 w-5" strokeWidth={1.8} />
              </button>
            </div>

            <nav aria-label="모바일 메뉴" className="flex-1 overflow-y-auto px-5 py-6">
              <ul className="space-y-1">
                {navItems.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between border-b border-rule/70 py-3.5 text-[19px] font-bold tracking-tight text-ink"
                    >
                      {item.label}
                      <ArrowUpRight className="h-5 w-5 text-ink-mute" strokeWidth={1.6} />
                    </Link>
                  </li>
                ))}
              </ul>

              <p className="label-mono mt-8 text-ink-mute">카테고리</p>
              <ul className="mt-3 space-y-3">
                {categories.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={categoryPath(category.slug)}
                      className="flex items-center gap-2.5 text-[15px] font-medium text-ink-soft"
                    >
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full ${toneStyles[categoryTone(category.slug)].solid}`}
                      />
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>

              <a
                href="/feed.xml"
                className="mt-8 inline-flex items-center gap-2 rounded-full border border-rule px-4 py-2 text-[13px] font-semibold text-ink-soft"
              >
                <Rss className="h-4 w-4" strokeWidth={1.8} />
                RSS로 구독
              </a>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
