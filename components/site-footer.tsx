import Link from "next/link";
import { ArrowUpRight, Rss } from "lucide-react";
import { categories, categoryTone, site } from "@/lib/site";
import { categoryPath } from "@/lib/urls";
import { toneStyles } from "./tone";
import { VisitorStats } from "./visitor-stats";

const groups = [
  {
    label: "안내",
    links: [
      { href: "/about/", label: "블로그 소개" },
      { href: "/contact/", label: "문의하기" },
      { href: "/posts/", label: "글 전체" },
    ],
  },
  {
    label: "약관",
    links: [
      { href: "/privacy/", label: "개인정보처리방침" },
      { href: "/terms/", label: "이용약관" },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-rule">
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-10 py-12 sm:grid-cols-12 sm:gap-8 sm:py-14">
          <div className="sm:col-span-5">
            <p className="flex items-baseline gap-2.5">
              <span className="font-editorial text-[19px] font-semibold tracking-[-0.02em] text-ink">
                {site.name}
              </span>
              <span className="font-mono text-[10px] tracking-[0.08em] text-ink-mute">
                harufive.kr
              </span>
            </p>
            <p className="mt-3.5 max-w-sm text-[13px] leading-[1.8] text-ink-soft">
              {site.description}
            </p>
            <a
              href={`mailto:${site.contactEmail}`}
              className="mt-5 inline-flex items-center gap-1.5 border-b border-rule pb-0.5 font-mono text-[10.5px] tracking-[0.04em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              {site.contactEmail}
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
            </a>
          </div>

          <nav aria-label="카테고리" className="sm:col-span-3">
            <p className="label-mono text-ink-mute">카테고리</p>
            <ul className="mt-3 border-t border-rule">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={categoryPath(category.slug)}
                    className="flex items-center gap-2 border-b border-rule/70 py-2.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
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
          </nav>

          {groups.map((group) => (
            <nav key={group.label} aria-label={group.label} className="sm:col-span-2">
              <p className="label-mono text-ink-mute">{group.label}</p>
              <ul className="mt-3 border-t border-rule">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block border-b border-rule/70 py-2.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-rule py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] leading-relaxed tracking-[0.04em] text-ink-mute">
            © {year} {site.name} ({site.latinName}.kr) · 운영 {site.author.name}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] tracking-[0.04em] text-ink-mute">
            <VisitorStats />
            <span aria-hidden="true" className="h-3 w-px bg-rule" />
            <a
              href="/feed.xml"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-ink"
            >
              <Rss className="h-3 w-3" strokeWidth={1.7} />
              RSS
            </a>
            <a href="/sitemap.xml" className="transition-colors hover:text-ink">
              SITEMAP
            </a>
          </div>
        </div>

        <p className="border-t border-rule/70 py-5 text-[11px] leading-[1.75] text-ink-mute">
          이 블로그의 글과 표의 저작권은 운영자에게 있습니다. Google AdSense 광고를 통해
          수익을 얻을 수 있으며, 광고 영역은 본문과 구분해 표시합니다.{" "}
          <Link
            href="/privacy/"
            className="underline decoration-rule underline-offset-2 transition-colors hover:text-ink"
          >
            쿠키와 광고 안내
          </Link>
        </p>
      </div>
    </footer>
  );
}
