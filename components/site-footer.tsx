import Link from "next/link";
import { Rss } from "lucide-react";
import { categories, categoryTone, site } from "@/lib/site";
import { categoryPath } from "@/lib/urls";
import { toneStyles } from "./tone";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-rule">
      <div className="mx-auto w-full max-w-[1180px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-12 sm:gap-8">
          <div className="sm:col-span-5">
            <p className="flex items-baseline gap-2">
              <span className="text-[19px] font-bold tracking-tight text-ink">{site.name}</span>
              <span className="font-display text-[12.5px] font-medium tracking-[0.02em] text-ink-mute">
                {site.latinName}.kr
              </span>
            </p>
            <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-ink-soft">
              {site.description}
            </p>
            <p className="label-mono mt-5 text-ink-mute">
              운영 {site.author.name} · <a href={`mailto:${site.contactEmail}`} className="underline decoration-rule underline-offset-2 hover:text-ink">{site.contactEmail}</a>
            </p>
          </div>

          <nav aria-label="카테고리" className="sm:col-span-3">
            <p className="label-mono text-ink-mute">카테고리</p>
            <ul className="mt-3 space-y-2.5">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={categoryPath(category.slug)}
                    className="group inline-flex items-center gap-2 text-[13.5px] text-ink-soft transition-colors hover:text-ink"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${toneStyles[categoryTone(category.slug)].solid} opacity-70 transition-opacity group-hover:opacity-100`}
                    />
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="안내" className="sm:col-span-2">
            <p className="label-mono text-ink-mute">안내</p>
            <ul className="mt-3 space-y-2.5 text-[13.5px] text-ink-soft">
              <li>
                <Link href="/about/" className="transition-colors hover:text-ink">
                  블로그 소개
                </Link>
              </li>
              <li>
                <Link href="/contact/" className="transition-colors hover:text-ink">
                  문의하기
                </Link>
              </li>
              <li>
                <Link href="/privacy/" className="transition-colors hover:text-ink">
                  개인정보처리방침
                </Link>
              </li>
              <li>
                <Link href="/terms/" className="transition-colors hover:text-ink">
                  이용약관
                </Link>
              </li>
            </ul>
          </nav>

          <div className="sm:col-span-2">
            <p className="label-mono text-ink-mute">구독</p>
            <ul className="mt-3 space-y-2.5 text-[13.5px] text-ink-soft">
              <li>
                <a href="/feed.xml" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink">
                  <Rss className="h-3.5 w-3.5" strokeWidth={1.8} />
                  RSS
                </a>
              </li>
              <li>
                <a href="/sitemap.xml" className="transition-colors hover:text-ink">
                  사이트맵
                </a>
              </li>
              <li>
                <Link href="/posts/" className="transition-colors hover:text-ink">
                  글 전체
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 space-y-2 border-t border-rule pt-6 text-[11.5px] leading-relaxed text-ink-mute">
          <p>
            © {year} {site.name} ({site.latinName}.kr). 이 블로그의 글과 표의 저작권은 운영자에게
            있습니다.
          </p>
          <p>
            Google AdSense 광고를 통해 수익을 얻을 수 있으며, 광고 영역은 본문과 구분해
            표시합니다.{" "}
            <Link href="/privacy/" className="underline decoration-rule underline-offset-2 hover:text-ink">
              쿠키와 광고 안내
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
