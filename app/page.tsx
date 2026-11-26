import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PostIndex } from "@/components/post-index";
import { categories, site } from "@/lib/site";
import { getAllPosts, postPath, toSummary } from "@/lib/posts";

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

const pad = (value: number) => String(value).padStart(2, "0");
const dotDate = (iso: string) => (iso ? iso.replace(/-/g, ".") : "");

export default function HomePage() {
  const posts = getAllPosts();
  const summaries = posts.map(toSummary);
  const featured = summaries.find((post) => post.featured) ?? summaries[0] ?? null;
  const latestDate = summaries[0]?.date ?? "";

  return (
    <>
      <section className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
        <div className="flex items-center justify-between gap-4 border-b border-rule py-3.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-mute">
          <span>AI 툴 · 자동화 · 생산성</span>
          <span className="hidden sm:inline">Harufive Index</span>
          <span className="tabular-nums">
            {latestDate ? `Vol. 01 — ${dotDate(latestDate)}` : "Vol. 01"}
          </span>
        </div>

        <div className="grid gap-12 pt-12 pb-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16">
          <div>
            <p className="label-mono flex items-center gap-2 text-ink-mute">
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-signal" />
              하루에 다섯 번, 반복을 덜어내는 기록
            </p>
            <h1 className="mt-5 font-editorial text-[clamp(2rem,4.8vw,3.7rem)] font-semibold leading-[1.28] tracking-[-0.035em] text-ink">
              다섯 칸짜리 작업대에서,
              <br />
              반복을 하나씩 덜어냅니다
            </h1>
            <p className="mt-6 max-w-[33rem] text-[14px] leading-[1.9] text-ink-soft sm:text-[15px]">
              ChatGPT·Claude부터 노코드 자동화까지, 실무에서 바로 쓰는 순서로 정리한
              가이드입니다. 거창한 시스템 대신 오늘 줄일 수 있는 10분부터 다룹니다.
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-6 border-t border-rule pt-5 lg:grid-cols-1 lg:gap-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div className="lg:border-b lg:border-rule lg:pb-4">
              <dt className="label-mono text-ink-mute">발행</dt>
              <dd className="mt-1.5 font-editorial text-[1.5rem] leading-none tracking-[-0.02em] text-ink tabular-nums">
                {pad(summaries.length)}
              </dd>
            </div>
            <div className="lg:border-b lg:border-rule lg:py-4">
              <dt className="label-mono text-ink-mute">주제</dt>
              <dd className="mt-1.5 font-editorial text-[1.5rem] leading-none tracking-[-0.02em] text-ink tabular-nums">
                {pad(categories.length)}
              </dd>
            </div>
            <div className="lg:pt-4">
              <dt className="label-mono text-ink-mute">최근 발행</dt>
              <dd className="mt-1.5 font-mono text-[11px] leading-none tracking-[0.04em] text-ink-soft tabular-nums lg:mt-2">
                {dotDate(latestDate)}
              </dd>
            </div>
          </dl>
        </div>

        {featured ? (
          <Link
            href={postPath(featured.slug)}
            className="group flex flex-col gap-3 border-t border-rule py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <span className="shrink-0 border border-ink px-1.5 py-[3px] font-mono text-[9px] uppercase leading-none tracking-[0.1em] text-ink">
                대표
              </span>
              <span className="font-editorial text-[15px] font-semibold leading-[1.5] text-ink transition-colors group-hover:text-signal sm:text-[16px]">
                {featured.title}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] tracking-[0.06em] text-ink-mute">
              <span className="tabular-nums">{featured.readingMinutes}분 읽기</span>
              <ArrowUpRight
                className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={1.8}
              />
            </span>
          </Link>
        ) : null}
      </section>

      <section
        className="mx-auto w-full max-w-[1180px] px-5 pt-10 sm:px-8 sm:pt-14"
        aria-labelledby="index-heading"
      >
        <div className="flex items-end justify-between gap-4 pb-6">
          <div>
            <p className="label-mono text-ink-mute">Index</p>
            <h2
              id="index-heading"
              className="mt-2 font-editorial text-[1.55rem] font-semibold tracking-[-0.02em] text-ink"
            >
              가이드
            </h2>
          </div>
          <Link
            href="/posts/"
            className="group inline-flex items-center gap-1.5 pb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:text-ink"
          >
            전체 목록
            <ArrowUpRight
              className="h-3 w-3 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Link>
        </div>

        <PostIndex
          posts={summaries}
          categories={categories}
          filters
          hint="행에 마우스를 올리면 요지와 태그가 먼저 보입니다. 번호는 발행 순서입니다."
        />
      </section>

      <section
        className="mx-auto w-full max-w-[1180px] px-5 pt-20 sm:px-8"
        aria-labelledby="principles-heading"
      >
        <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
          <h2
            id="principles-heading"
            className="font-editorial text-[1.35rem] font-semibold tracking-[-0.02em] text-ink"
          >
            이 블로그가 지키는 세 가지
          </h2>
          <p className="label-mono text-ink-mute">원칙 01—03</p>
        </div>

        <div className="grid divide-y divide-rule sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {principles.map((principle, index) => (
            <div
              key={principle.title}
              className="py-6 sm:px-7 sm:pb-2 sm:first:pl-0 sm:last:pr-0"
            >
              <span className="font-mono text-[9.5px] tabular-nums tracking-[0.1em] text-signal">
                {pad(index + 1)}
              </span>
              <h3 className="mt-3 font-editorial text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">
                {principle.title}
              </h3>
              <p className="mt-2 text-[13px] leading-[1.85] text-ink-soft">
                {principle.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1180px] px-5 pt-20 sm:px-8">
        <div className="grid gap-6 border-t border-ink/70 pt-8 pb-2 sm:grid-cols-[9rem_1fr] sm:gap-10">
          <p className="label-mono text-ink-mute">문의</p>
          <div>
            <h2 className="font-editorial text-[clamp(1.35rem,2.6vw,1.9rem)] font-semibold leading-[1.4] tracking-[-0.03em] text-ink">
              다뤄 주길 바라는 주제가 있나요
            </h2>
            <p className="mt-3 max-w-[34rem] text-[13.5px] leading-[1.85] text-ink-soft">
              지금 막혀 있는 업무 자동화 상황을 한두 문장으로 알려 주시면, 실제 사례로
              정리해 글을 씁니다. 도구 가격이나 기능이 바뀐 부분을 발견하셔도 알려
              주세요.
            </p>
            <a
              href={`mailto:${site.contactEmail}`}
              className="group mt-5 inline-flex items-center gap-2 border-b border-ink/30 pb-1 font-mono text-[11px] tracking-[0.04em] text-ink transition-colors hover:border-ink"
            >
              {site.contactEmail}
              <ArrowUpRight
                className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={1.8}
              />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
