import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroBento } from "@/components/hero-bento";
import { PostExplorer } from "@/components/post-explorer";
import { categories, site } from "@/lib/site";
import { getAllPosts, getAllTags, toSummary } from "@/lib/posts";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const principles = [
  {
    title: "도구는 조합으로",
    body: "유료 결제부터 하지 않습니다. 무료 한도 안에서 역할이 겹치지 않는 조합을 먼저 만들고, 부족한 부분만 유료로 채웁니다.",
  },
  {
    title: "프롬프트는 문서로",
    body: "머릿속 지시를 매번 새로 쓰지 않습니다. 재사용 가능한 구조로 남겨 두면 결과 편차가 줄고 검토 시간도 줄어듭니다.",
  },
  {
    title: "자동화는 작게",
    body: "하루 10분짜리 반복부터 없앱니다. 크게 설계한 자동화는 유지보수에서 무너지기 쉽습니다.",
  },
];

export default function HomePage() {
  const posts = getAllPosts();
  const summaries = posts.map(toSummary);
  const featured = summaries.find((post) => post.featured) ?? summaries[0] ?? null;
  const latestDate = summaries[0]?.date ?? "";
  const tags = getAllTags();

  return (
    <>
      <section className="mx-auto w-full max-w-[1180px] px-5 pt-12 sm:px-8 sm:pt-16">
        <div className="flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between sm:gap-12">
          <div>
            <p className="label-mono flex items-center gap-2 text-ink-mute">
              <span aria-hidden="true" className="h-px w-6 bg-signal" />
              AI 툴 · 자동화 · 생산성
            </p>
            <h1 className="mt-4 text-[clamp(2rem,4vw,3.25rem)] font-bold leading-[1.16] tracking-[-0.045em] text-ink">
              다섯 칸짜리 작업대에서,
              <br />
              반복을 하나씩 덜어냅니다
            </h1>
          </div>

          <p className="max-w-[22rem] text-[13.5px] leading-[1.75] text-ink-soft sm:pb-1 sm:text-right">
            ChatGPT·Claude부터 노코드 자동화까지, 실무에서 바로 쓰는 순서로 정리한
            가이드입니다. 거창한 시스템 대신 오늘 줄일 수 있는 10분부터 다룹니다.
          </p>
        </div>

        <HeroBento
          featured={featured}
          total={summaries.length}
          latestDate={latestDate}
          categoryCount={categories.length}
        />
      </section>

      <section
        className="mx-auto w-full max-w-[1180px] px-5 pt-16 sm:px-8 sm:pt-20"
        aria-labelledby="guides-heading"
      >
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
          <div>
            <h2
              id="guides-heading"
              className="text-[1.4rem] font-bold tracking-[-0.035em] text-ink"
            >
              가이드
            </h2>
            <p className="mt-1.5 text-[13px] text-ink-soft">
              주제를 고르면 그 칸의 글만 남습니다.
            </p>
          </div>
          <Link
            href="/posts/"
            className="group inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-soft transition-colors hover:text-ink"
          >
            글 전체 보기
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Link>
        </header>

        <div className="mt-6">
          <PostExplorer posts={summaries} categories={categories} tags={tags} />
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-[1180px] px-5 pt-20 sm:px-8"
        aria-labelledby="principles-heading"
      >
        <h2
          id="principles-heading"
          className="text-[1.4rem] font-bold tracking-[-0.035em] text-ink"
        >
          이 블로그가 지키는 세 가지
        </h2>

        <div className="mt-6 grid gap-px bg-rule sm:grid-cols-3">
          {principles.map((principle) => (
            <div key={principle.title} className="bg-canvas py-6 pr-6 sm:pl-6 sm:first:pl-0">
              <h3 className="text-[15px] font-bold tracking-tight text-ink">
                {principle.title}
              </h3>
              <p className="mt-2.5 text-[13px] leading-[1.75] text-ink-soft">
                {principle.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1180px] px-5 pt-16 sm:px-8">
        <div className="bento sm:grid-cols-[1fr_auto]">
          <div className="tile">
            <h2 className="text-[1.15rem] font-bold tracking-tight text-ink">
              다뤄 주길 바라는 주제가 있나요
            </h2>
            <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed text-ink-soft">
              지금 막혀 있는 업무 자동화 상황을 한두 문장으로 알려 주시면, 실제 사례로
              정리해 글을 씁니다. 도구 가격이나 기능이 바뀐 부분을 발견하셔도 알려
              주세요.
            </p>
          </div>
          <div className="tile flex items-center sm:min-w-[13rem]">
            <Link
              href="/contact/"
              className="group inline-flex items-center gap-2 text-[13.5px] font-bold text-ink"
            >
              <span className="border-b border-ink/30 pb-0.5 transition-colors group-hover:border-ink">
                {site.contactEmail}
              </span>
              <ArrowRight
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                strokeWidth={2}
              />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
