import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { AdSlot } from "@/components/ad-slot";
import { JsonLd } from "@/components/json-ld";
import { MdxContent } from "@/components/mdx-content";
import { PostIndex } from "@/components/post-index";
import { TableOfContents } from "@/components/table-of-contents";
import { ReadingProgress } from "@/components/reading-progress";
import { CopyButton } from "@/components/copy-button";
import { CategoryChip } from "@/components/category-chip";
import { categoryName, site } from "@/lib/site";
import {
  absoluteUrl,
  categoryPath,
  getAdjacentPosts,
  getAllPosts,
  getPost,
  getRelatedPosts,
  postPath,
  tagPath,
  toSummary,
} from "@/lib/posts";

type Params = { slug: string };

const pad = (value: number) => String(value).padStart(2, "0");
const dotDate = (iso: string) => (iso ? iso.replace(/-/g, ".") : "");

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

  const all = getAllPosts();
  const articleNumber = all.findIndex((item) => item.slug === post.slug) + 1;
  const related = getRelatedPosts(post, 3).map(toSummary);
  const { newer, older } = getAdjacentPosts(post);
  const url = absoluteUrl(postPath(post.slug));

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
      <ReadingProgress />

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
            <Link
              href={categoryPath(post.category)}
              className="transition-colors hover:text-ink"
            >
              {categoryName(post.category)}
            </Link>
          </li>
          <li aria-hidden="true" className="hidden opacity-50 sm:block">
            /
          </li>
          <li className="hidden max-w-[22rem] truncate text-ink-soft sm:block">
            {post.title}
          </li>
        </ol>
        <span className="label-mono hidden shrink-0 text-ink-mute tabular-nums sm:block">
          Article {pad(articleNumber)} / {pad(all.length)}
        </span>
      </nav>

      <header className="pt-10 sm:pt-14">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-mute">
          <CategoryChip category={post.category} asLink />
          <span aria-hidden="true" className="font-mono text-[10.5px] opacity-50">
            ·
          </span>
          <time
            dateTime={post.date}
            className="label-mono tabular-nums text-ink-mute"
          >
            {dotDate(post.date)}
          </time>
          <span aria-hidden="true" className="font-mono text-[10.5px] opacity-50">
            ·
          </span>
          <span className="label-mono flex items-center gap-1 text-ink-mute">
            <Clock className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
            <span className="tabular-nums">{post.readingMinutes}분</span>
          </span>
          {post.updated && post.updated !== post.date ? (
            <>
              <span aria-hidden="true" className="font-mono text-[10.5px] opacity-50">
                ·
              </span>
              <span className="label-mono text-ink-mute tabular-nums">
                수정 {dotDate(post.updated)}
              </span>
            </>
          ) : null}
        </div>

        <h1 className="mt-5 max-w-[44rem] font-editorial text-[clamp(1.7rem,3.3vw,2.8rem)] font-semibold leading-[1.32] tracking-[-0.03em] text-ink">
          {post.title}
        </h1>

        {post.description ? (
          <p className="mt-5 max-w-[38rem] text-[14.5px] leading-[1.9] text-ink-soft sm:text-[15px]">
            {post.description}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-4">
          <p className="flex items-center gap-2.5 text-[12px] text-ink-soft">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-ink text-[10px] font-semibold text-ink">
              {site.author.name.slice(0, 1)}
            </span>
            <span className="font-semibold text-ink">{post.author}</span>
            <span aria-hidden="true" className="h-2.5 w-px bg-rule" />
            <span className="text-ink-mute">{site.author.role}</span>
          </p>

          <CopyButton value={url} label="이 글 링크 복사" copiedLabel="링크 복사됨" />
        </div>
      </header>

      <div className="mt-10 grid gap-14 lg:grid-cols-[minmax(0,1fr)_13.5rem] lg:gap-16">
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
            <ul className="mt-12 flex flex-wrap gap-1.5 border-t border-rule pt-5">
              {post.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={tagPath(tag)}
                    className="inline-flex border border-rule px-2 py-1 font-mono text-[10.5px] tracking-[0.02em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  >
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-10 flex gap-4 border-t border-rule pt-6">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink text-[11px] font-semibold text-ink">
              {site.author.name.slice(0, 1)}
            </span>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-mute">
                운영자
              </p>
              <p className="mt-1.5 text-[13px] font-semibold text-ink">
                {post.author}
                <span className="ml-2 font-normal text-ink-mute">{site.author.role}</span>
              </p>
              <p className="mt-1.5 max-w-[34rem] text-[12.5px] leading-[1.85] text-ink-soft">
                {site.author.bio} 이 글에서 다룬 도구는 직접 써 보고 정리했으며, 광고나
                협찬 없이 작성했습니다.{" "}
                <Link
                  href="/about/"
                  className="underline decoration-rule underline-offset-2 transition-colors hover:text-ink"
                >
                  편집 원칙 보기
                </Link>
              </p>
            </div>
          </div>

          <nav
            className="mt-10 grid border-t border-rule sm:grid-cols-2"
            aria-label="이전/다음 글"
          >
            {newer ? (
              <Link
                href={postPath(newer.slug)}
                className="group flex flex-col gap-2 border-b border-rule py-5 transition-colors hover:bg-surface sm:border-b-0 sm:border-r sm:pr-6"
              >
                <span className="label-mono flex items-center gap-1.5 text-ink-mute">
                  <ArrowLeft className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                  다음 글
                </span>
                <span className="font-editorial text-[14px] font-semibold leading-[1.5] text-ink transition-colors group-hover:text-signal">
                  {newer.title}
                </span>
              </Link>
            ) : (
              <span className="hidden sm:block" />
            )}
            {older ? (
              <Link
                href={postPath(older.slug)}
                className="group flex flex-col gap-2 py-5 transition-colors hover:bg-surface sm:items-end sm:pl-6"
              >
                <span className="label-mono flex items-center gap-1.5 text-ink-mute">
                  이전 글
                  <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="font-editorial text-[14px] font-semibold leading-[1.5] text-ink transition-colors group-hover:text-signal sm:text-right">
                  {older.title}
                </span>
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

            <div className="border-t border-rule pt-4">
              <p className="label-mono text-ink-mute">이 글</p>
              <dl className="mt-3 space-y-1.5 font-mono text-[10.5px] tracking-[0.03em]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-mute">발행</dt>
                  <dd className="text-ink-soft tabular-nums">{dotDate(post.date)}</dd>
                </div>
                {post.updated && post.updated !== post.date ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-mute">수정</dt>
                    <dd className="text-ink-soft tabular-nums">
                      {dotDate(post.updated)}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-mute">분량</dt>
                  <dd className="text-ink-soft tabular-nums">
                    {post.readingMinutes}분
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-mute">글자</dt>
                  <dd className="text-ink-soft tabular-nums">
                    {post.characterCount.toLocaleString("ko-KR")}
                  </dd>
                </div>
              </dl>
            </div>

            <AdSlot slot={site.adsense.slotSidebar} format="rectangle" label="광고" />
          </div>
        </aside>
      </div>

      {related.length > 0 ? (
        <section className="mt-20 border-t border-rule pt-8">
          <div className="flex items-end justify-between gap-4 pb-6">
            <div>
              <p className="label-mono text-ink-mute">Next</p>
              <h2 className="mt-2 font-editorial text-[1.35rem] font-semibold tracking-[-0.02em] text-ink">
                함께 읽으면 좋은 글
              </h2>
            </div>
            <Link
              href="/posts/"
              className="inline-flex items-center gap-1.5 pb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:text-ink"
            >
              전체 목록
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          </div>

          <PostIndex posts={related} compact />
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
