"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { ArrowUpRight, Clock } from "lucide-react";
import type { PostSummary } from "@/lib/posts";
import { categoryName, categoryTone, type Category } from "@/lib/site";
import { postPath } from "@/lib/urls";
import { toneStyles } from "./tone";

type Props = {
  posts: PostSummary[];
  /** 필터 칩에 쓸 카테고리 목록. filters 가 false 면 쓰지 않는다. */
  categories?: Category[];
  /** 카테고리 필터 칩과 개수 카운터를 보일지 */
  filters?: boolean;
  /** 관련 글처럼 좁은 자리에 놓는 축소판 */
  compact?: boolean;
  /** 목록 아래 한 줄 안내 (데스크톱에서만) */
  hint?: string;
  className?: string;
};

const pad = (value: number) => String(value).padStart(2, "0");
const dotDate = (iso: string) => (iso ? iso.replace(/-/g, ".") : "");

const PREVIEW_WIDTH = 336;
const PREVIEW_HEIGHT = 250;

/**
 * 글 인덱스 — 카드 격자 대신 1px 헤어라인으로 나눈 행 목록.
 *
 * 행: 번호 · 날짜/카테고리 · 헤드라인 · 한 줄 요지 · 원형 화살표.
 * 데스크톱에서 마우스를 올리면 행 위에 계측선이 그어지고, 커서 옆에
 * 요지와 태그를 담은 미리보기 카드가 따라붙는다.
 */
export function PostIndex({
  posts,
  categories = [],
  filters = false,
  compact = false,
  hint,
  className = "",
}: Props) {
  const reduce = useReducedMotion();
  const [category, setCategory] = useState<string>("all");
  const [hovered, setHovered] = useState<{ post: PostSummary; number: number } | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const numbered = useMemo(
    () => posts.map((post, index) => ({ post, number: index + 1 })),
    [posts],
  );

  /** 번호는 필터와 상관없이 목록에서의 자리를 가리킨다(글이 사라져도 번호가 흔들리지 않게). */
  const visible = useMemo(
    () =>
      category === "all"
        ? numbered
        : numbered.filter((entry) => entry.post.category === category),
    [numbered, category],
  );

  const placePreview = (clientX: number, clientY: number) => {
    if (typeof window === "undefined") return;
    const edge = 16;
    let left = clientX + 34;
    if (left + PREVIEW_WIDTH > window.innerWidth - edge) {
      left = clientX - PREVIEW_WIDTH - 34;
    }
    left = Math.max(edge, left);

    let top = clientY + 22;
    top = Math.min(Math.max(top, 92), window.innerHeight - PREVIEW_HEIGHT - edge);

    x.set(left);
    y.set(top);
  };

  const onEnter = (
    entry: { post: PostSummary; number: number },
    event: React.PointerEvent,
  ) => {
    if (event.pointerType !== "mouse") return;
    placePreview(event.clientX, event.clientY);
    setHovered(entry);
  };

  const onMove = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (!hovered) return;
    placePreview(event.clientX, event.clientY);
  };

  const cellPadding = compact
    ? "px-3 py-4 sm:px-6 sm:py-5"
    : "px-3 py-4.5 sm:px-8 sm:py-7 lg:py-8";
  const numberPadding = compact ? "pt-4 sm:pt-5" : "pt-4 sm:pt-7 lg:pt-8";

  return (
    <div className={className}>
      <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-end sm:justify-between">
        {filters && categories.length > 0 ? (
          <div
            role="group"
            aria-label="카테고리로 거르기"
            className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0"
          >
            <button
              type="button"
              className="chip shrink-0"
              data-active={category === "all"}
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              <span
                aria-hidden="true"
                className="chip-dot h-1.5 w-1.5 rounded-full bg-ink"
              />
              전체
            </button>
            {categories.map((item) => {
              const count = numbered.filter(
                (entry) => entry.post.category === item.slug,
              ).length;
              if (count === 0) return null;
              return (
                <button
                  key={item.slug}
                  type="button"
                  className="chip shrink-0"
                  data-active={category === item.slug}
                  aria-pressed={category === item.slug}
                  onClick={() =>
                    setCategory(category === item.slug ? "all" : item.slug)
                  }
                >
                  <span
                    aria-hidden="true"
                    className={`chip-dot h-1.5 w-1.5 rounded-full ${toneStyles[categoryTone(item.slug)].solid}`}
                  />
                  {item.name}
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}

        <p
          aria-live="polite"
          className="label-mono flex shrink-0 items-baseline gap-1 self-end text-ink-mute sm:self-auto"
        >
          <span className="text-[15px] font-medium tabular-nums tracking-[0.02em] text-ink">
            {pad(visible.length)}
          </span>
          <span aria-hidden="true" className="tabular-nums">
            / {pad(numbered.length)}
          </span>
          <span className="sr-only">편 표시</span>
        </p>
      </div>

      {visible.length > 0 ? (
        <ol key={category} className="index-enter border-b border-rule">
          {visible.map((entry) => {
            const { post, number } = entry;
            const tone = toneStyles[categoryTone(post.category)];

            return (
              <li
                key={post.slug}
                className="group/row relative border-t border-rule transition-colors duration-300 hover:bg-surface"
                onPointerEnter={(event) => onEnter(entry, event)}
                onPointerMove={onMove}
                onPointerLeave={() => setHovered(null)}
              >
                {/* 계측 오버레이 — hover 한 행에만 그어진다. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px origin-left scale-x-0 bg-signal transition-transform duration-500 ease-out group-hover/row:scale-x-100"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-px -top-px z-10 hidden h-2 w-2 border-l border-t border-signal opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 lg:block"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-px -top-px z-10 hidden h-2 w-2 border-r border-t border-signal opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 lg:block"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-px -bottom-px z-10 hidden h-2 w-2 border-b border-l border-signal opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 lg:block"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-px -bottom-px z-10 hidden h-2 w-2 border-b border-r border-signal opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 lg:block"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 z-20 hidden -translate-y-1/2 items-center gap-1.5 bg-signal px-1.5 py-[3px] font-mono text-[9px] uppercase leading-none tracking-[0.1em] text-surface opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 lg:flex"
                >
                  Article {pad(number)} · {post.readingMinutes} min
                </span>

                <Link
                  href={postPath(post.slug)}
                  aria-label={`${post.title} — ${categoryName(post.category)}, ${post.readingMinutes}분`}
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)_2.25rem] items-stretch focus-visible:outline-offset-[-2px] sm:grid-cols-[4.5rem_minmax(0,1fr)_5.5rem]"
                >
                  <span
                    className={`flex items-start pl-0.5 font-mono text-[10.5px] tabular-nums tracking-[0.06em] text-ink-mute transition-colors duration-300 group-hover/row:text-signal ${numberPadding}`}
                  >
                    {pad(number)}
                  </span>

                  <div
                    className={`flex min-w-0 flex-col border-l border-rule ${cellPadding}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] tracking-[0.06em] text-ink-mute">
                      <time dateTime={post.date} className="tabular-nums">
                        {dotDate(post.date)}
                      </time>
                      <span aria-hidden="true" className="opacity-50">
                        ·
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={`h-1 w-1 rounded-full ${tone.solid}`}
                        />
                        {categoryName(post.category)}
                      </span>
                      <span className="ml-auto hidden items-center gap-1 transition-colors duration-300 group-hover/row:text-ink-soft sm:inline-flex">
                        <Clock className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
                        <span className="tabular-nums">{post.readingMinutes}분</span>
                      </span>
                    </div>

                    <h3
                      className={`mt-2 font-editorial font-semibold leading-[1.45] tracking-[-0.02em] text-ink sm:mt-2.5 ${
                        compact
                          ? "text-[0.98rem] sm:text-[1.0625rem]"
                          : "text-[1.03rem] sm:text-[1.3rem] lg:text-[1.4rem]"
                      }`}
                    >
                      {post.title}
                    </h3>

                    <p
                      className={`mt-1.5 line-clamp-2 text-[12.5px] leading-[1.7] text-ink-soft sm:mt-2 sm:line-clamp-1 ${
                        compact ? "sm:text-[12.5px]" : "sm:text-[13.5px]"
                      }`}
                    >
                      {post.description}
                    </p>
                  </div>

                  <span className="flex items-center justify-center border-l border-rule">
                    <span
                      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-rule text-ink transition-all duration-300 group-hover/row:border-ink group-hover/row:bg-ink group-hover/row:text-surface ${
                        compact ? "h-8 w-8" : "h-8 w-8 sm:h-11 sm:w-11"
                      }`}
                    >
                      <ArrowUpRight
                        className={`transition-transform duration-300 group-hover/row:rotate-45 ${
                          compact ? "h-3 w-3" : "h-3.5 w-3.5 sm:h-4 sm:w-4"
                        }`}
                        strokeWidth={1.7}
                        aria-hidden="true"
                      />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="border-b border-t border-rule py-16 text-center">
          <p className="font-editorial text-[1.1rem] font-semibold text-ink">
            이 조건에는 아직 글이 없습니다
          </p>
          <p className="mt-2 text-[13px] text-ink-soft">
            다른 주제를 고르거나 전체 목록에서 다시 찾아보세요.
          </p>
          <button
            type="button"
            onClick={() => setCategory("all")}
            className="mt-5 inline-flex items-center gap-1.5 border-b border-ink pb-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink"
          >
            전체 보기
          </button>
        </div>
      )}

      {hint ? (
        <p className="mt-3 hidden font-mono text-[10px] tracking-[0.06em] text-ink-mute lg:block">
          {hint}
        </p>
      ) : null}

      <AnimatePresence>
        {hovered ? (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-40 hidden w-[21rem] lg:block"
            style={{ x, y }}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{
              duration: reduce ? 0 : 0.18,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="border border-ink/15 bg-surface/95 p-4 shadow-[0_26px_60px_-30px_rgba(16,20,19,0.5)] backdrop-blur-sm">
              <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-ink-mute">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1 w-1 rounded-full ${toneStyles[categoryTone(hovered.post.category)].solid}`}
                  />
                  {categoryName(hovered.post.category)}
                </span>
                <span className="tabular-nums">
                  {pad(hovered.number)} / {pad(numbered.length)}
                </span>
              </div>

              <p className="mt-2.5 font-editorial text-[15px] font-semibold leading-[1.45] tracking-[-0.02em] text-ink">
                {hovered.post.title}
              </p>
              <p className="mt-2 line-clamp-4 text-[12px] leading-[1.7] text-ink-soft">
                {hovered.post.description}
              </p>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-rule pt-2 font-mono text-[9px] tracking-[0.06em] text-ink-mute">
                <span className="truncate">
                  {hovered.post.tags
                    .slice(0, 2)
                    .map((tag) => `#${tag}`)
                    .join(" ")}
                </span>
                <span className="shrink-0 tabular-nums">
                  읽기 {hovered.post.readingMinutes}분
                </span>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
