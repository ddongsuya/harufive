import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Rss } from "lucide-react";
import { PostIndex } from "@/components/post-index";
import { categories } from "@/lib/site";
import { getAllPosts, getAllTags, tagPath, toSummary } from "@/lib/posts";

export const metadata: Metadata = {
  title: "글 전체",
  description:
    "AI 툴, 프롬프트, 업무 자동화, 생산성 도구에 대해 정리한 글 전체 목록입니다.",
  alternates: { canonical: "/posts/" },
};

const pad = (value: number) => String(value).padStart(2, "0");
const dotDate = (iso: string) => (iso ? iso.replace(/-/g, ".") : "");

export default function PostsPage() {
  const summaries = getAllPosts().map(toSummary);
  const tags = getAllTags();
  const latest = summaries[0]?.date ?? "";

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
      <header className="border-b border-rule pt-12 pb-8 sm:pt-16 sm:pb-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-mono flex items-center gap-2 text-ink-mute">
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-signal" />
              전체 목록
            </p>
            <h1 className="mt-4 font-editorial text-[clamp(1.9rem,4vw,3rem)] font-semibold leading-[1.22] tracking-[-0.035em] text-ink">
              글 전체
            </h1>
            <p className="mt-4 max-w-[32rem] text-[13.5px] leading-[1.85] text-ink-soft">
              지금까지 발행한 {summaries.length}편의 가이드입니다. 최신 글이 위에 오고,
              주제를 고르면 그 칸의 글만 남습니다.
            </p>
          </div>

          <p className="label-mono flex items-center gap-2.5 pb-1 text-ink-mute">
            <span className="tabular-nums">{pad(summaries.length)}편</span>
            {latest ? (
              <>
                <span aria-hidden="true" className="h-2.5 w-px bg-rule" />
                <span className="tabular-nums">최근 {dotDate(latest)}</span>
              </>
            ) : null}
          </p>
        </div>
      </header>

      <div className="mt-10">
        <PostIndex
          posts={summaries}
          categories={categories}
          filters
          hint="행에 마우스를 올리면 요지와 태그가 먼저 보입니다."
        />
      </div>

      {tags.length > 0 ? (
        <section className="mt-16 border-t border-rule pt-6" aria-labelledby="tags-heading">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="tags-heading" className="label-mono text-ink-mute">
              태그
            </h2>
            <p className="label-mono text-ink-mute tabular-nums">{pad(tags.length)}개</p>
          </div>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag.slug}>
                <Link
                  href={tagPath(tag.name)}
                  className="inline-flex items-center gap-1.5 border border-rule px-2 py-1 font-mono text-[10.5px] tracking-[0.02em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                >
                  #{tag.name}
                  <span className="text-ink-mute/60 tabular-nums">{tag.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-14 flex items-center justify-between gap-4 border-t border-rule pt-6">
        <a
          href="/feed.xml"
          className="group inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:text-ink"
        >
          <Rss className="h-3.5 w-3.5" strokeWidth={1.7} />
          RSS
          <span aria-hidden="true" className="h-px w-6 bg-signal" />
          새 글을 받아 보기
        </a>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-mute transition-colors hover:text-ink"
        >
          홈
          <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </p>
    </div>
  );
}
