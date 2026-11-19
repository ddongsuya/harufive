import Link from "next/link";
import type { Metadata } from "next";
import { PostCard } from "@/components/post-card";
import { categories, site } from "@/lib/site";
import {
  categoryPath,
  getAllPosts,
  getPostsByCategory,
} from "@/lib/posts";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const pillars = [
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
  const [featured, ...rest] = posts;
  const latest = rest.slice(0, 5);

  return (
    <>
      <section className="border-b border-line bg-gradient-to-b from-brand-soft/70 via-paper to-paper">
        <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
            AI 툴 · 자동화 &amp; 생산성 가이드
          </p>
          <h1 className="mt-4 max-w-2xl text-[2rem] font-bold leading-[1.28] tracking-tight text-ink sm:text-[2.7rem]">
            반복은 줄이고,
            <br className="sm:hidden" /> 판단에 집중하는 하루
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-soft sm:text-base">
            AI 도구를 처음 붙잡는 분부터 매일 쓰는 분까지. 프롬프트 설계,
            노코드 자동화, 무료 도구 조합을 실무 순서대로 정리합니다. 거창한
            시스템보다 오늘 바로 줄일 수 있는 10분에 집중합니다.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/posts/"
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              글 전체 보기
            </Link>
            <Link
              href="/about/"
              className="rounded-lg border border-line bg-paper px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-dark"
            >
              블로그 소개
            </Link>
          </div>

          <dl className="mt-10 flex gap-8 text-sm">
            <div>
              <dt className="text-xs text-ink-mute">발행한 글</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {posts.length}편
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">카테고리</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {categories.length}개
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">운영</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {site.author.name}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {featured ? (
        <section className="mx-auto w-full max-w-5xl px-5 pt-14 sm:px-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-mute">
              이번 주 읽을 글
            </h2>
          </div>
          <div className="mt-4">
            <PostCard post={featured} featured />
          </div>
        </section>
      ) : null}

      <section className="mx-auto w-full max-w-5xl px-5 pt-14 sm:px-6">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-bold tracking-tight text-ink">최신 글</h2>
          <Link
            href="/posts/"
            className="text-sm font-medium text-brand-dark hover:underline"
          >
            전체 보기 →
          </Link>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {latest.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 pt-16 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-ink">카테고리</h2>
        <p className="mt-2 text-sm text-ink-soft">
          지금 궁금한 지점에서 시작하세요.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {categories.map((category) => {
            const count = getPostsByCategory(category.slug).length;
            return (
              <Link
                key={category.slug}
                href={categoryPath(category.slug)}
                className="rounded-xl border border-line bg-paper p-5 transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold text-ink">
                    {category.name}
                  </span>
                  <span className="text-xs text-ink-mute">{count}편</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {category.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 pt-16 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-ink">
          이 블로그가 지키는 세 가지
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {pillars.map((pillar, index) => (
            <div
              key={pillar.title}
              className="rounded-xl border border-line bg-paper-alt/60 p-5"
            >
              <span className="text-xs font-bold text-brand">
                0{index + 1}
              </span>
              <h3 className="mt-2 text-base font-semibold text-ink">
                {pillar.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {pillar.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
