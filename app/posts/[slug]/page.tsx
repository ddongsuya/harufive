import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdSlot } from "@/components/ad-slot";
import { JsonLd } from "@/components/json-ld";
import { MdxContent } from "@/components/mdx-content";
import { PostCard } from "@/components/post-card";
import { TableOfContents } from "@/components/table-of-contents";
import { categoryName, site } from "@/lib/site";
import {
  absoluteUrl,
  categoryPath,
  formatDate,
  getAdjacentPosts,
  getAllPosts,
  getPost,
  getRelatedPosts,
  postPath,
  tagPath,
} from "@/lib/posts";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "글을 찾을 수 없습니다" };

  const url = postPath(post.slug);

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    keywords: [...post.tags, categoryName(post.category)],
    authors: [{ name: post.author, url: absoluteUrl("/about/") }],
    openGraph: {
      type: "article",
      url: absoluteUrl(url),
      title: post.title,
      description: post.description,
      siteName: site.name,
      locale: site.locale,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [post.author],
      tags: post.tags,
      images: [
        {
          url: site.ogImage,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [site.ogImage],
    },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) notFound();

  const related = getRelatedPosts(post, 2);
  const { newer, older } = getAdjacentPosts(post);
  const url = absoluteUrl(postPath(post.slug));

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6">
      <nav aria-label="위치" className="text-xs text-ink-mute">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand-dark">
              홈
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={categoryPath(post.category)}
              className="hover:text-brand-dark"
            >
              {categoryName(post.category)}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-soft">{post.title}</li>
        </ol>
      </nav>

      <header className="mt-6 border-b border-line pb-8">
        <Link
          href={categoryPath(post.category)}
          className="inline-block rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-dark"
        >
          {categoryName(post.category)}
        </Link>

        <h1 className="mt-4 text-[1.9rem] font-bold leading-[1.3] tracking-tight text-ink sm:text-[2.3rem]">
          {post.title}
        </h1>

        {post.description ? (
          <p className="mt-4 text-[16px] leading-relaxed text-ink-soft sm:text-[17px]">
            {post.description}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-mute">
          <span className="font-medium text-ink-soft">{post.author}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          {post.updated && post.updated !== post.date ? (
            <>
              <span aria-hidden="true">·</span>
              <span>수정 {formatDate(post.updated)}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span>{post.readingMinutes}분 읽기</span>
        </div>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0">
          <AdSlot
            slot={site.adsense.slotArticle}
            format="fluid"
            layout="in-article"
            label="광고"
          />

          <article className="article-prose prose max-w-none">
            <MdxContent source={post.content} />
          </article>

          {post.tags.length > 0 ? (
            <ul className="mt-10 flex flex-wrap gap-2 border-t border-line pt-6">
              {post.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={tagPath(tag)}
                    className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft transition-colors hover:border-brand hover:text-brand-dark"
                  >
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-8 rounded-xl border border-line bg-paper-alt/60 p-5">
            <p className="text-sm font-semibold text-ink">
              {post.author} · {site.author.role}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {site.author.bio} 이 글에서 다룬 도구는 모두 직접 써 보고 정리한
              내용이며, 광고나 협찬 없이 작성했습니다.{" "}
              <Link href="/about/" className="underline">
                편집 원칙 보기
              </Link>
            </p>
          </div>

          <nav className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="이전/다음 글">
            {newer ? (
              <Link
                href={postPath(newer.slug)}
                className="rounded-xl border border-line p-4 transition-colors hover:border-brand/40"
              >
                <span className="text-xs text-ink-mute">최신 글</span>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {newer.title}
                </p>
              </Link>
            ) : (
              <span />
            )}
            {older ? (
              <Link
                href={postPath(older.slug)}
                className="rounded-xl border border-line p-4 text-right transition-colors hover:border-brand/40 sm:text-right"
              >
                <span className="text-xs text-ink-mute">이전 글</span>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {older.title}
                </p>
              </Link>
            ) : null}
          </nav>

          <AdSlot
            slot={site.adsense.slotArticle}
            format="auto"
            label="광고"
            className="mt-10"
          />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-6">
            <TableOfContents items={post.toc} />
            <AdSlot
              slot={site.adsense.slotSidebar}
              format="rectangle"
              label="광고"
            />
          </div>
        </aside>
      </div>

      {related.length > 0 ? (
        <section className="mt-16 border-t border-line pt-10">
          <h2 className="text-lg font-bold tracking-tight text-ink">
            함께 읽으면 좋은 글
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {related.map((item) => (
              <PostCard key={item.slug} post={item} />
            ))}
          </div>
        </section>
      ) : null}

      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "@id": `${url}#article`,
            mainEntityOfPage: { "@type": "WebPage", "@id": url },
            url,
            headline: post.title,
            description: post.description,
            datePublished: post.date,
            dateModified: post.updated ?? post.date,
            inLanguage: "ko-KR",
            wordCount: post.characterCount,
            articleSection: categoryName(post.category),
            keywords: post.tags.join(", "),
            author: {
              "@type": "Person",
              name: post.author,
              url: absoluteUrl("/about/"),
            },
            publisher: {
              "@type": "Organization",
              name: site.name,
              url: site.url,
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "홈",
                item: site.url,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: categoryName(post.category),
                item: absoluteUrl(categoryPath(post.category)),
              },
              {
                "@type": "ListItem",
                position: 3,
                name: post.title,
                item: url,
              },
            ],
          },
        ]}
      />
    </div>
  );
}
