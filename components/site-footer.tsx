import Link from "next/link";
import { categories, site } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-line bg-paper-alt/70">
      <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <p className="text-base font-semibold text-ink">{site.name}</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              {site.description}
            </p>
            <p className="mt-4 text-xs text-ink-mute">
              운영 · {site.author.name}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
              카테고리
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`/categories/${category.slug}/`}
                    className="text-ink-soft transition-colors hover:text-brand-dark"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
              안내
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  href="/about/"
                  className="text-ink-soft transition-colors hover:text-brand-dark"
                >
                  블로그 소개
                </Link>
              </li>
              <li>
                <Link
                  href="/contact/"
                  className="text-ink-soft transition-colors hover:text-brand-dark"
                >
                  문의하기
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy/"
                  className="text-ink-soft transition-colors hover:text-brand-dark"
                >
                  개인정보처리방침
                </Link>
              </li>
              <li>
                <Link
                  href="/terms/"
                  className="text-ink-soft transition-colors hover:text-brand-dark"
                >
                  이용약관
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-6 text-xs text-ink-mute sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {site.name} ({site.latinName}.kr). All rights reserved.
          </p>
          <p>
            이 블로그는 Google AdSense 광고를 통해 수익을 얻을 수 있으며, 광고
            영역은 본문과 구분되어 표시됩니다.{" "}
            <Link href="/privacy/" className="underline">
              자세히
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
