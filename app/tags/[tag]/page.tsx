import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PostTile } from "@/components/post-tile";
import { site } from "@/lib/site";
import { getAllTags, getPostsByTag, tagPath, toSummary } from "@/lib/posts";

type Params = { tag: string };

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
              태그
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-soft">#{name}</li>
        </ol>
      </nav>

      <header className="mt-6 border-t-2 border-ink/15 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="label-mono text-ink-mute">태그</p>
            <h1 className="mt-2.5 text-[clamp(1.8rem,3.4vw,2.6rem)] font-bold leading-[1.2] tracking-[-0.04em] text-ink">
              #{name}
            </h1>
          </div>
          <p className="label-mono pb-1 text-ink-mute">{posts.length}편</p>
        </div>
      </header>

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

      {allTags.length > 0 ? (
        <div className="mt-12 border-t border-rule pt-6">
          <p className="label-mono text-ink-mute">다른 태그</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {allTags.map((item) => (
              <li key={item.slug}>
                <Link
                  href={tagPath(item.name)}
                  className="inline-flex rounded-md border border-rule px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                >
                  #{item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-10">
        <Link
          href="/posts/"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-soft transition-colors hover:text-ink"
        >
          전체 글 보기
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </p>
    </div>
  );
}
