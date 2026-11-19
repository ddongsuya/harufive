import Link from "next/link";
import { site } from "@/lib/site";

const navItems = [
  { href: "/posts/", label: "글" },
  { href: "/about/", label: "소개" },
  { href: "/contact/", label: "문의" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-[15px] font-bold text-white transition-colors group-hover:bg-brand-dark">
            하
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-tight text-ink">
              {site.name}
            </span>
            <span className="mt-1 text-[11px] font-medium tracking-wide text-ink-mute">
              AI 툴 · 자동화 · 생산성
            </span>
          </span>
        </Link>

        <nav aria-label="주요 메뉴" className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-brand-soft hover:text-brand-dark sm:px-3"
            >
              {item.label}
            </Link>
          ))}
          <a
            href="/feed.xml"
            className="ml-1 hidden rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-dark sm:inline-block"
          >
            RSS
          </a>
        </nav>
      </div>
    </header>
  );
}
