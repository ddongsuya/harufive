import type { Metadata } from "next";
import { PostExplorer } from "@/components/post-explorer";
import { categories } from "@/lib/site";
import { getAllPosts, getAllTags, toSummary } from "@/lib/posts";

export const metadata: Metadata = {
  title: "글 전체",
  description:
    "AI 툴, 프롬프트, 업무 자동화, 생산성 도구에 대해 정리한 글 전체 목록입니다.",
  alternates: { canonical: "/posts/" },
};

export default function PostsPage() {
  const posts = getAllPosts();
  const summaries = posts.map(toSummary);
  const tags = getAllTags();
  const latest = summaries[0]?.date ?? "";

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-rule pb-6 pt-12 sm:pt-16">
        <div>
          <p className="label-mono flex items-center gap-2 text-ink-mute">
            <span aria-hidden="true" className="h-px w-6 bg-signal" />
            전체 목록
          </p>
          <h1 className="mt-3.5 text-[clamp(1.8rem,3.4vw,2.6rem)] font-bold leading-[1.2] tracking-[-0.04em] text-ink">
            글 전체
          </h1>
          <p className="mt-3 max-w-lg text-[13.5px] leading-[1.75] text-ink-soft">
            지금까지 발행한 {summaries.length}편의 가이드입니다. 최신 글이 위에 오고,
            주제나 태그로 거를 수 있습니다.
          </p>
        </div>

        <p className="label-mono flex items-center gap-2.5 pb-1 text-ink-mute">
          <span>{summaries.length}편</span>
          {latest ? <span aria-hidden="true" className="h-3 w-px bg-rule" /> : null}
          {latest ? <span>최근 {latest.replace(/-/g, ".")}</span> : null}
        </p>
      </header>

      <div className="mt-8">
        <PostExplorer posts={summaries} categories={categories} tags={tags} />
      </div>

      <p className="mt-14 border-t border-rule pt-6">
        <a
          href="/feed.xml"
          className="label-mono inline-flex items-center gap-2 text-ink-soft transition-colors hover:text-ink"
        >
          RSS
          <span aria-hidden="true" className="h-px w-6 bg-signal" />
          새 글을 받아 보기
        </a>
      </p>
    </div>
  );
}
