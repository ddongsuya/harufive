import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { PostIndex } from "@/components/post-index";
import { site } from "@/lib/site";
import { getAllTags, getPostsByTag, tagPath, toSummary } from "@/lib/posts";

type Params = { tag: string };

const pad = (value: number) => String(value).padStart(2, "0");

export function generateStaticParams(): Params[] {
  return getAllTags().map((tag) => ({ tag: tag.slug }));
}

function resolveTagParam(raw: string): string | undefined {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 이미 디코딩된 값이면 그대로 쓴다.
  }
  return getAllTags().find((tag) => tag.slug === decoded)?.name;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { tag: raw } = await params;
  const name = resolveTagParam(raw);
  if (!name) return { title: "태그를 찾을 수 없습니다" };

  return {
    title: `#${name} 글 모음`,
    description: `${name} 태그로 정리한 ${site.name}의 글 목록입니다.`,
    alternates: { canonical: tagPath(name) },
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tag: raw } = await params;
  const name = resolveTagParam(raw);
  if (!name) notFound();

  const posts = getPostsByTag(name).map(toSummary);
  const allTags = getAllTags().filter((item) => item.name !== name);

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
              태그
            </Link>
          </li>
          <li aria-hidden="true" className="opacity-50">
            /
          </li>
          <li className="truncate text-ink-soft">#{name}</li>
        </ol>
        <span className="label-mono hidden shrink-0 text-ink-mute tabular-nums sm:block">
          {pad(posts.length)} Article
        </span>
      </nav>

      <header className="border-b border-rule pt-10 pb-8 sm:pt-14 sm:pb-10">
        <p className="label-mono flex items-center gap-2 text-ink-mute">
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-signal" />
          태그
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <h1 className="font-editorial text-[clamp(1.7rem,3.6vw,2.6rem)] font-semibold leading-[1.26] tracking-[-0.03em] text-ink">
            #{name}
          </h1>
          <p className="label-mono pb-1 text-ink-mute tabular-nums">
            {pad(posts.length)}편
          </p>
        </div>
      </header>

      <div className="mt-8">
        <PostIndex posts={posts} />
      </div>

      {allTags.length > 0 ? (
        <section className="mt-16 border-t border-rule pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="label-mono text-ink-mute">다른 태그</h2>
            <span className="label-mono text-ink-mute tabular-nums">
              {pad(allTags.length)}
            </span>
          </div>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {allTags.map((item) => (
              <li key={item.slug}>
                <Link
                  href={tagPath(item.name)}
                  className="inline-flex items-center gap-1.5 border border-rule px-2 py-1 font-mono text-[10.5px] tracking-[0.02em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                >
                  #{item.name}
                  <span className="text-ink-mute/60 tabular-nums">{item.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-12 border-t border-rule pt-6">
        <Link
          href="/posts/"
          className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:text-ink"
        >
          전체 글 보기
          <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </p>
    </div>
  );
}
