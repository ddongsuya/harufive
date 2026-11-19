"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import type { PostSummary, TagInfo } from "@/lib/posts";
import { categoryName, categoryTone, type Category } from "@/lib/site";
import { toneStyles } from "./tone";
import { PostTile } from "./post-tile";

type Props = {
  posts: PostSummary[];
  categories: Category[];
  tags: TagInfo[];
  /** 첫 칸을 넓게 쓸지 (글이 충분할 때만) */
  leadThreshold?: number;
};

const itemMotion = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

export function PostExplorer({ posts, categories, tags, leadThreshold = 5 }: Props) {
  const reduce = useReducedMotion();
  const [category, setCategory] = useState<string>("all");
  const [tag, setTag] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      posts.filter(
        (post) =>
          (category === "all" || post.category === category) &&
          (tag === null || post.tags.includes(tag)),
      ),
    [posts, category, tag],
  );

  const lead = visible.length >= leadThreshold;
  const filtered = category !== "all" || tag !== null;
  const gridCols =
    visible.length >= 3
      ? "sm:grid-cols-2 lg:grid-cols-3"
      : visible.length === 2
        ? "sm:grid-cols-2"
        : "";

  return (
    <div>
      <div className="flex flex-col gap-3">
        <div
          role="group"
          aria-label="카테고리로 거르기"
          className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <button
            type="button"
            className="chip shrink-0"
            data-active={category === "all"}
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            전체
            <span className="label-mono opacity-60">{posts.length}</span>
          </button>
          {categories.map((item) => {
            const count = posts.filter((post) => post.category === item.slug).length;
            if (count === 0) return null;
            const style = toneStyles[categoryTone(item.slug)];
            return (
              <button
                key={item.slug}
                type="button"
                className="chip shrink-0"
                data-active={category === item.slug}
                aria-pressed={category === item.slug}
                onClick={() => setCategory(category === item.slug ? "all" : item.slug)}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${category === item.slug ? "bg-surface" : style.solid}`}
                />
                {item.name}
                <span className="label-mono opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {tags.length > 0 ? (
          <div
            role="group"
            aria-label="태그로 거르기"
            className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tags.slice(0, 10).map((item) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => setTag(tag === item.name ? null : item.name)}
                aria-pressed={tag === item.name}
                className={[
                  "shrink-0 rounded-md px-2 py-1 text-[11.5px] transition-colors",
                  tag === item.name
                    ? "bg-ink text-surface"
                    : "text-ink-mute hover:bg-sunk hover:text-ink",
                ].join(" ")}
              >
                #{item.name}
              </button>
            ))}

            {filtered ? (
              <button
                type="button"
                onClick={() => {
                  setCategory("all");
                  setTag(null);
                }}
                className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-signal hover:bg-signal/10"
              >
                <X className="h-3 w-3" strokeWidth={2.2} />
                조건 지우기
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t border-rule pt-4">
        <p className="text-[13px] text-ink-soft" aria-live="polite">
          {filtered ? (
            <>
              <strong className="font-semibold text-ink">
                {category !== "all" ? categoryName(category) : "전체"}
              </strong>
              {tag ? (
                <>
                  {" "}
                  안에서 <strong className="font-semibold text-ink">#{tag}</strong>
                </>
              ) : null}
              <span className="text-ink-mute"> · {visible.length}편</span>
            </>
          ) : (
            <span className="text-ink-mute">최신 글부터 {visible.length}편</span>
          )}
        </p>
        <p className="label-mono hidden text-ink-mute sm:block">주제나 태그로 거를 수 있습니다</p>
      </div>

      {visible.length > 0 ? (
        <motion.ul
          layout={!reduce}
          className={`bento mt-4 grid-cols-1 ${gridCols} ${
            visible.length === 1 ? "max-w-[42rem]" : ""
          }`}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map((post, index) => (
              <motion.li
                key={post.slug}
                layout={!reduce}
                variants={reduce ? undefined : itemMotion}
                initial={reduce ? false : "hidden"}
                whileInView={reduce ? undefined : "show"}
                viewport={{ once: true, amount: 0.15 }}
                exit={
                  reduce
                    ? undefined
                    : { opacity: 0, scale: 0.97, transition: { duration: 0.14 } }
                }
                transition={{
                  duration: reduce ? 0 : 0.4,
                  ease: [0.22, 1, 0.36, 1],
                  delay: reduce ? 0 : Math.min(index * 0.045, 0.3),
                }}
                className={[
                  "min-w-0",
                  lead && index === 0 ? "sm:col-span-2" : "",
                ].join(" ")}
              >
                <PostTile post={post} lead={lead && index === 0} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      ) : (
        <div className="mt-4 rounded-xl border border-rule bg-surface p-8 text-center">
          <p className="text-[15px] font-semibold text-ink">이 조합에는 아직 글이 없습니다</p>
          <p className="mt-2 text-[13px] text-ink-soft">
            조건을 하나 빼거나 전체 목록에서 다시 골라 보세요.
          </p>
          <button
            type="button"
            onClick={() => {
              setCategory("all");
              setTag(null);
            }}
            className="mt-5 inline-flex items-center rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-surface"
          >
            조건 지우기
          </button>
        </div>
      )}
    </div>
  );
}
