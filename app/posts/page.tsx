import type { Metadata } from "next";
import { PostCard } from "@/components/post-card";
import { getAllPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "글 전체",
  description:
    "AI 툴, 프롬프트, 업무 자동화, 생산성 도구에 대해 정리한 글 전체 목록입니다.",
  alternates: { canonical: "/posts/" },
};

export default function PostsPage() {
  const posts = getAllPosts();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          Archive
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">
          글 전체
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          지금까지 발행한 {posts.length}편의 글입니다. 최신 글이 위에 옵니다.
        </p>
      </header>

      <div className="mt-10 grid gap-4">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>

      {posts.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-paper-alt p-6 text-sm text-ink-soft">
          아직 발행한 글이 없습니다.
        </p>
      ) : null}
    </div>
  );
}
