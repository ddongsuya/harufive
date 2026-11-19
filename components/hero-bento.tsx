"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { ArrowRight, ArrowUpRight, Clock, Rss } from "lucide-react";
import type { PostSummary } from "@/lib/posts";
import { categoryPath, formatDate, postPath } from "@/lib/urls";
import { categoryName, categoryTone, site } from "@/lib/site";
import { toneStyles } from "./tone";
import { CopyButton } from "./copy-button";

type Props = {
  featured: PostSummary | null;
  total: number;
  latestDate: string;
  categoryCount: number;
};

const intents = [
  { label: "프롬프트가 자꾸 흔들린다", target: "prompting", hint: "다섯 칸 구조" },
  { label: "반복 업무부터 없애고 싶다", target: "automation", hint: "자동화 순서" },
  { label: "무료 도구 조합이 필요하다", target: "tools", hint: "다섯 자리" },
  { label: "AI에 뭘 맡길 수 있나", target: "ai-basics", hint: "챗봇과 에이전트" },
];

export function HeroBento({ featured, total, latestDate, categoryCount }: Props) {
  const reduce = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const glow = useMotionTemplate`radial-gradient(340px circle at ${mx}px ${my}px, rgba(214, 88, 52, 0.26), rgba(214, 88, 52, 0) 70%)`;
  const [hoverIntent, setHoverIntent] = useState<string | null>(null);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || event.pointerType !== "mouse") return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    mx.set(event.clientX - rect.left);
    my.set(event.clientY - rect.top);
  };

  return (
    <div className="bento mt-9 grid-cols-2 sm:grid-cols-6 sm:[grid-auto-rows:minmax(148px,auto)]">
      {featured ? (
        <article
          ref={cardRef}
          onPointerMove={onPointerMove}
          className="tile tile-deep bench-grid group relative col-span-2 flex min-h-[320px] flex-col justify-between overflow-hidden sm:col-span-4 sm:row-span-2 sm:min-h-[360px]"
        >
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{ background: glow }}
          />

          <div className="relative flex items-center justify-between gap-4">
            <p className="label-mono flex items-center gap-2 text-surface/65">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />
              대표 가이드
            </p>
            <p className="label-mono text-surface/55">{formatDate(featured.date)}</p>
          </div>

          <div className="relative mt-8 max-w-[36rem]">
            <h2 className="text-[clamp(1.65rem,2.6vw,2.35rem)] font-bold leading-[1.28] tracking-[-0.035em] text-surface">
              <Link href={postPath(featured.slug)} className="after:absolute after:inset-0">
                {featured.title}
              </Link>
            </h2>
            <p className="mt-4 line-clamp-3 max-w-[32rem] text-[14.5px] leading-relaxed text-[#b9c3bd]">
              {featured.description}
            </p>
          </div>

          <div className="relative mt-8 flex flex-wrap items-center justify-between gap-4">
            <p className="flex items-center gap-2.5 text-[12.5px] font-semibold text-surface/80">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${toneStyles[categoryTone(featured.category)].solid}`}
              />
              {categoryName(featured.category)}
              <span aria-hidden="true" className="h-3 w-px bg-surface/25" />
              <span className="inline-flex items-center gap-1.5 font-normal text-surface/65">
                <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
                {featured.readingMinutes}분
              </span>
            </p>

            <span className="inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-[12.5px] font-bold text-deep transition-transform duration-300 group-hover:translate-x-0.5">
              읽기
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
            </span>
          </div>
        </article>
      ) : null}

      {/* 어디서 시작할지 고르는 칸 — 실제로는 카테고리로 보낸다. */}
      <div className="tile col-span-2 sm:col-span-2">
        <p className="label-mono text-ink-mute">어디서 시작할까</p>
        <ul className="mt-3 space-y-px">
          {intents.map((intent) => {
            const active = hoverIntent === intent.target;
            const style = toneStyles[categoryTone(intent.target)];
            return (
              <li key={intent.target} className="relative">
                {active ? (
                  <motion.span
                    layoutId="intent-highlight"
                    className="absolute inset-0 rounded-md bg-sunk"
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 500, damping: 40 }
                    }
                  />
                ) : null}
                <Link
                  href={categoryPath(intent.target)}
                  onMouseEnter={() => setHoverIntent(intent.target)}
                  onFocus={() => setHoverIntent(intent.target)}
                  onMouseLeave={() => setHoverIntent(null)}
                  onBlur={() => setHoverIntent(null)}
                  className="relative flex items-center justify-between gap-3 rounded-md px-2 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.solid}`}
                    />
                    <span className="truncate text-[13.5px] font-semibold text-ink">
                      {intent.label}
                    </span>
                  </span>
                  <AnimatePresence initial={false} mode="wait">
                    {active ? (
                      <motion.span
                        key="hint"
                        initial={{ opacity: 0, x: reduce ? 0 : -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0 : 0.16 }}
                        className="label-mono shrink-0 text-ink-mute"
                      >
                        {intent.hint}
                      </motion.span>
                    ) : (
                      <motion.span
                        key="arrow"
                        className="shrink-0 text-ink-mute"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 발행 현황 */}
      <div className="tile flex flex-col justify-between sm:col-span-1">
        <p className="label-mono text-ink-mute">발행</p>
        <p className="mt-4 font-display text-[2.4rem] font-bold leading-none tracking-[-0.05em] text-ink">
          {String(total).padStart(2, "0")}
        </p>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-mute">
          편의 가이드
          <br />
          {categoryCount}개 주제
        </p>
        <p className="label-mono mt-4 border-t border-rule/70 pt-2.5 text-ink-mute">
          최근 {latestDate.slice(5).replace("-", ".")}
        </p>
      </div>

      {/* 구독 */}
      <div className="tile flex flex-col justify-between sm:col-span-1">
        <p className="label-mono text-ink-mute">구독</p>
        <p className="mt-4 text-[13px] font-semibold leading-snug text-ink">
          RSS로 새 글을 받아 보세요
        </p>
        <div className="mt-4 flex items-center gap-1.5">
          <a
            href="/feed.xml"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-rule text-ink-soft transition-colors hover:border-ink hover:text-ink"
            aria-label="RSS 피드 열기"
          >
            <Rss className="h-3.5 w-3.5" strokeWidth={1.9} />
          </a>
          <CopyButton
            value={`${site.url}/feed.xml`}
            label="주소 복사"
            copiedLabel="복사됨"
            className="px-2"
          />
        </div>
      </div>
    </div>
  );
}
