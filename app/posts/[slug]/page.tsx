import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { AdSlot } from "@/components/ad-slot";
import { JsonLd } from "@/components/json-ld";
import { MdxContent } from "@/components/mdx-content";
import { PostTile } from "@/components/post-tile";
import { TableOfContents } from "@/components/table-of-contents";
import { ReadingProgress } from "@/components/reading-progress";
import { CopyButton } from "@/components/copy-button";
import { CategoryChip } from "@/components/category-chip";
import { categoryName, categoryTone, site } from "@/lib/site";
import { toneStyles } from "@/components/tone";
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
  toSummary,
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

  const related = getRelatedPosts(post, 3).map(toSummary);
  const { newer, older } = getAdjacentPosts(post);
  const url = absoluteUrl(postPath(post.slug));
  const postTone = toneStyles[categoryTone(post.category)];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
      <ReadingProgress />

      <nav aria-label="위치" className="pt-8">
        <ol className="label-mono flex flex-wrap items-center gap-2 text-ink-mute">
          <li>
            <Link href="/" className="transition-colors hover:text-ink">
              홈
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={categoryPath(post.category)}
              className="transition-colors hover:text-ink"
            >
              {categoryName(post.category)}
            </Link>
          </li>
          <li aria-hidden="true" className="hidden sm:block">/</li>
          <li className="hidden max-w-none truncate text-ink-soft sm:block">{post.title}</li>
        </ol>
      </nav>

      <header className={`mt-7 border-t-2 pt-7 ${postTone.border}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CategoryChip category={post.category} asLink />
          <span aria-hidden="true" className="h-3 w-px bg-rule" />
          <time dateTime={post.date} className="label-mono text-ink-mute">
            {formatDate(post.date)}
          </time>
          {post.updated && post.updated !== post.date ? (
            <>
              <span aria-hidden="true" className="h-3 w-px bg-rule" />
              <span className="label-mono text-ink-mute">수정 {formatDate(post.updated)}</span>
            </>
          ) : null}
          <span aria-hidden="true" className="h-3 w-px bg-rule" />
          <span className="label-mono flex items-center gap-1.5 text-ink-mute">
            <Clock className="h-3 w-3" strokeWidth={1.8} />
            {post.readingMinutes}분
          </span>
        </div>

        <h1 className="mt-5 max-w-[46rem] text-[clamp(1.75rem,3.3vw,2.75rem)] font-bold leading-[1.22] tracking-[-0.042em] text-ink">
          {post.title}
        </h1>

        {post.description ? (
          <p className="mt-4 max-w-[40rem] text-[14.5px] leading-[1.8] text-ink-soft sm:text-[15.5px]">
            {post.description}
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <p className="flex items-center gap-2.5 text-[12.5px] text-ink-soft">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-surface">
              {site.author.name.slice(0, 1)}
            </span>
            <span className="font-semibold text-ink">{post.author}</span>
            <span aria-hidden="true" className="h-3 w-px bg-rule" />
            <span className="text-ink-mute">{site.author.role}</span>
          </p>

          <CopyButton value={url} label="이 글 링크 복사" copiedLabel="링크 복사됨" />
        </div>
      </header>

      <div className="mt-9 grid gap-12 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14">
        <div className="min-w-0">
          <div className="lg:hidden">
            <TableOfContents items={post.toc} variant="inline" />
          </div>

          <div className="mt-6 lg:mt-0">
            <AdSlot
              slot={site.adsense.slotArticle}
              format="fluid"
              layout="in-article"
              label="광고"
            />
          </div>

          <article className="article-prose prose max-w-none">
            <MdxContent source={post.content} />
          </article>

          {post.tags.length > 0 ? (
            <ul className="mt-12 flex flex-wrap gap-2 border-t border-rule pt-6">
              {post.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={tagPath(tag)}
                    className="inline-flex rounded-md border border-rule px-2 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  >
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-8 grid gap-4 rounded-xl border border-rule bg-surface p-5 sm:grid-cols-[auto_1fr] sm:gap-5 sm:p-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink text-[15px] font-bold text-surface">
              {site.author.name.slice(0, 1)}
            </span>
            <div>
              <p className="text-[13.5px] font-bold text-ink">
                {post.author}
                <span className="ml-2 font-normal text-ink-mute">{site.author.role}</span>
              </p>
              <p className="mt-1.5 text-[12.5px] leading-[1.75] text-ink-soft">
                {site.author.bio} 이 글에서 다룬 도구는 직접 써 보고 정리했으며, 광고나 협찬
                없이 작성했습니다.{" "}
                <Link href="/about/" className="underline decoration-rule underline-offset-2 hover:text-ink">
                  편집 원칙 보기
                </Link>
              </p>
            </div>
          </div>

          <nav className="mt-8 grid gap-px border border-rule bg-rule sm:grid-cols-2" aria-label="이전/다음 글">
            {newer ? (
              <Link href={postPath(newer.slug)} className="group bg-surface p-5 transition-colors hover:bg-[#fdfcf7]">
                <span className="label-mono flex items-center gap-1.5 text-ink-mute">
                  <ArrowLeft className="h-3 w-3" strokeWidth={2} />
                  다음 글
                </span>
                <p className="mt-2 text-[13.5px] font-semibold leading-snug text-ink">
                  {newer.title}
                </p>
              </Link>
            ) : (
              <span className="hidden bg-surface sm:block" />
            )}
            {older ? (
              <Link
                href={postPath(older.slug)}
                className="group bg-surface p-5 transition-colors hover:bg-[#fdfcf7] sm:text-right"
              >
                <span className="label-mono flex items-center gap-1.5 text-ink-mute sm:justify-end">
                  이전 글
                  <ArrowRight className="h-3 w-3" strokeWidth={2} />
                </span>
                <p className="mt-2 text-[13.5px] font-semibold leading-snug text-ink">
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
          <div className="sticky top-24 space-y-8">
            <TableOfContents items={post.toc} />

            <div className="border-t border-rule pt-5">
              <p className="label-mono text-ink-mute">이 글</p>
              <dl className="mt-3 space-y-2 text-[12px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-mute">발행</dt>
                  <dd className="text-ink-soft">{formatDate(post.date)}</dd>
                </div>
                {post.updated && post.updated !== post.date ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-mute">수정</dt>
                    <dd className="text-ink-soft">{formatDate(post.updated)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-mute">분량</dt>
                  <dd className="text-ink-soft">{post.readingMinutes}분</dd>
                </div>
              </dl>
            </div>

            <AdSlot slot={site.adsense.slotSidebar} format="rectangle" label="광고" />
          </div>
        </aside>
      </div>

      {related.length > 0 ? (
        <section className="mt-20 border-t border-rule pt-10">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-[1.3rem] font-bold tracking-[-0.03em] text-ink">함께 읽으면 좋은 글</h2>
            <Link
              href="/posts/"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              글 전체 보기
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          </div>

          <div
            className={`bento mt-5 grid-cols-1 ${
              related.length >= 3 ? "sm:grid-cols-3" : related.length === 2 ? "sm:grid-cols-2" : ""
            }`}
          >
            {related.map((item) => (
              <PostTile key={item.slug} post={item} />
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
