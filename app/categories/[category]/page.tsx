import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { PostIndex } from "@/components/post-index";
import { categories, categoryTone, getCategory, site } from "@/lib/site";
import { toneStyles } from "@/components/tone";
import {
  absoluteUrl,
  categoryPath,
  getPostsByCategory,
  toSummary,
} from "@/lib/posts";

type Params = { category: string };

const pad = (value: number) => String(value).padStart(2, "0");

export function generateStaticParams(): Params[] {
  return categories.map((category) => ({ category: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const category = getCategory(slug);
  if (!category) return { title: "카테고리를 찾을 수 없습니다" };

  return {
    title: `${category.name} 글 모음`,
    description: category.description,
    alternates: { canonical: categoryPath(category.slug) },
    openGraph: {
      type: "website",
      title: `${category.name} | ${site.name}`,
      description: category.description,
      url: absoluteUrl(categoryPath(category.slug)),
      images: [site.ogImage],
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category: slug } = await params;
  const category = getCategory(slug);
  if (!category) notFound();

  const posts = getPostsByCategory(category.slug).map(toSummary);
  const catTone = toneStyles[categoryTone(category.slug)];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
      <nav
        aria-label="위치"
        className="flex items-center justify-between gap-4 border-b border-rule py-3.5"
      >
        <ol className="label-mono flex min-w-0 items-center gap-2 text-ink-mute">
          <li>
            <Link href="/" className="transition-colors hover:text-ink">
              홈
            </Link>
          </li>
          <li aria-hidden="true" className="opacity-50">
            /
          </li>
          <li>
            <Link href="/posts/" className="transition-colors hover:text-ink">
              카테고리
            </Link>
          </li>
          <li aria-hidden="true" className="opacity-50">
            /
          </li>
          <li className="truncate text-ink-soft">{category.name}</li>
        </ol>
        <span className="label-mono hidden shrink-0 text-ink-mute tabular-nums sm:block">
          {pad(posts.length)} Article
        </span>
      </nav>

      <header className="border-b border-rule pt-10 pb-8 sm:pt-14 sm:pb-10">
        <p className="label-mono flex items-center gap-2 text-ink-mute">
          <span aria-hidden="true" className={`h-1 w-1 rounded-full ${catTone.solid}`} />
          카테고리
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-editorial text-[clamp(1.7rem,3.6vw,2.6rem)] font-semibold leading-[1.26] tracking-[-0.03em] text-ink">
              {category.name}
            </h1>
            <p className="mt-3.5 max-w-xl text-[13.5px] leading-[1.85] text-ink-soft">
              {category.description}
            </p>
          </div>
          <p className="label-mono pb-1 text-ink-mute tabular-nums">
            {pad(posts.length)}편
          </p>
        </div>
      </header>

      <div className="mt-8">
        {posts.length > 0 ? (
          <PostIndex posts={posts} />
        ) : (
          <div className="border-b border-t border-rule py-16 text-center">
            <p className="font-editorial text-[1.1rem] font-semibold text-ink">
              이 칸에는 아직 글이 없습니다
            </p>
            <p className="mt-2 text-[13px] text-ink-soft">
              전체 목록에서 다른 주제를 골라 보세요.
            </p>
            <Link
              href="/posts/"
              className="mt-5 inline-flex items-center gap-1.5 border-b border-ink pb-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink"
            >
              전체 글 보기
              <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          </div>
        )}
      </div>

      <section className="mt-16 border-t border-rule pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="label-mono text-ink-mute">다른 카테고리</h2>
          <span className="label-mono text-ink-mute tabular-nums">
            {pad(categories.length - 1)}
          </span>
        </div>
        <ul className="mt-4 grid gap-1.5 sm:grid-cols-3">
          {categories
            .filter((item) => item.slug !== category.slug)
            .map((item) => (
              <li key={item.slug}>
                <Link
                  href={categoryPath(item.slug)}
                  className="group flex items-center justify-between gap-3 border border-rule px-3 py-2.5 transition-colors hover:border-ink"
                >
                  <span className="flex items-center gap-2 text-[13px] text-ink-soft transition-colors group-hover:text-ink">
                    <span
                      aria-hidden="true"
                      className={`h-1 w-1 rounded-full ${toneStyles[categoryTone(item.slug)].solid}`}
                    />
                    {item.name}
                  </span>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 text-ink-mute transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    strokeWidth={1.8}
                  />
                </Link>
              </li>
            ))}
        </ul>
      </section>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "홈", item: site.url },
            {
              "@type": "ListItem",
              position: 2,
              name: category.name,
              item: absoluteUrl(categoryPath(category.slug)),
            },
          ],
        }}
      />
    </div>
  );
}
