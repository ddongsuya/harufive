import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { PostCard } from "@/components/post-card";
import { categories, getCategory, site } from "@/lib/site";
import { absoluteUrl, categoryPath, getPostsByCategory } from "@/lib/posts";

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

  const posts = getPostsByCategory(category.slug);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-6">
      <nav aria-label="위치" className="text-xs text-ink-mute">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand-dark">
              홈
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>카테고리</li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-soft">{category.name}</li>
        </ol>
      </nav>

      <header className="mt-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">
          {category.name}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          {category.description}
        </p>
        <p className="mt-2 text-xs text-ink-mute">총 {posts.length}편</p>
      </header>

      <div className="mt-10 grid gap-4">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>

      {posts.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-paper-alt p-6 text-sm text-ink-soft">
          이 카테고리에 아직 글이 없습니다.{" "}
          <Link href="/posts/" className="underline">
            전체 글 보기
          </Link>
        </p>
      ) : null}

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
