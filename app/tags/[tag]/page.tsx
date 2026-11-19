import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostCard } from "@/components/post-card";
import { site } from "@/lib/site";
import { getAllTags, getPostsByTag, tagPath } from "@/lib/posts";

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

  const posts = getPostsByTag(name);

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
          <li>태그</li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-soft">#{name}</li>
        </ol>
      </nav>

      <header className="mt-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">
          #{name}
        </h1>
        <p className="mt-2 text-xs text-ink-mute">총 {posts.length}편</p>
      </header>

      <div className="mt-10 grid gap-4">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>

      <p className="mt-12 text-xs text-ink-mute">
        <Link href="/posts/" className="underline">
          전체 글 보기
        </Link>
      </p>
    </div>
  );
}
