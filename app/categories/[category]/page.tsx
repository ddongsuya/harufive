import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { PostTile } from "@/components/post-tile";
import { categories, categoryTone, getCategory, site } from "@/lib/site";
import { toneStyles } from "@/components/tone";
import { absoluteUrl, categoryPath, getPostsByCategory, toSummary } from "@/lib/posts";

type Params = { category: string };

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
      <nav aria-label="위치" className="pt-8">
        <ol className="label-mono flex items-center gap-2 text-ink-mute">
          <li>
            <Link href="/" className="transition-colors hover:text-ink">
              홈
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/posts/" className="transition-colors hover:text-ink">
              카테고리
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-soft">{category.name}</li>
        </ol>
      </nav>

      <header className={`mt-6 border-t-2 pt-6 ${catTone.border}`}>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className={`inline-flex items-center gap-2 text-[12px] font-semibold ${catTone.text}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${catTone.solid}`} />
              카테고리
            </p>
            <h1 className="mt-2.5 text-[clamp(1.8rem,3.4vw,2.6rem)] font-bold leading-[1.2] tracking-[-0.04em] text-ink">
              {category.name}
            </h1>
            <p className="mt-3 max-w-xl text-[13.5px] leading-[1.75] text-ink-soft">
              {category.description}
            </p>
          </div>
          <p className="label-mono pb-1 text-ink-mute">{posts.length}편</p>
        </div>
      </header>

      {posts.length > 0 ? (
        <div
          className={`bento mt-8 grid-cols-1 ${
            posts.length >= 3
              ? "sm:grid-cols-2 lg:grid-cols-3"
              : posts.length === 2
                ? "sm:grid-cols-2"
                : ""
          }`}
        >
          {posts.map((post, index) => (
            <PostTile key={post.slug} post={post} lead={index === 0} />
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-rule bg-surface p-8">
          <p className="text-[15px] font-semibold text-ink">이 칸에는 아직 글이 없습니다</p>
          <p className="mt-2 text-[13px] text-ink-soft">전체 목록에서 다른 주제를 골라 보세요.</p>
          <Link
            href="/posts/"
            className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink"
          >
            전체 글 보기
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>
      )}

      <div className="mt-12 flex flex-wrap gap-2 border-t border-rule pt-6">
        {categories
          .filter((item) => item.slug !== category.slug)
          .map((item) => (
            <Link
              key={item.slug}
              href={categoryPath(item.slug)}
              className="inline-flex items-center gap-1.5 rounded-full border border-rule px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${toneStyles[categoryTone(item.slug)].solid}`}
              />
              {item.name}
            </Link>
          ))}
      </div>

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
