"use client";

import Link from "next/link";
import { ArrowUpRight, Clock } from "lucide-react";
import type { PostSummary } from "@/lib/posts";
import { formatDate, postPath, tagPath } from "@/lib/urls";
import { categoryName, categoryTone } from "@/lib/site";
import { toneStyles } from "./tone";

type Props = {
  post: PostSummary;
  lead?: boolean;
};

/**
 * 글 한 편을 한 칸으로. 칸 자체는 판(bento)의 일부라 테두리를 갖지 않고,
 * 마우스를 올리면 칸 위쪽에 카테고리 색 선이 자란다.
 */
export function PostTile({ post, lead = false }: Props) {
  const style = toneStyles[categoryTone(post.category)];

  return (
    <article
      className={[
        "group/tile relative flex h-full flex-col bg-surface p-5 transition-colors duration-300 sm:p-6",
        "hover:bg-[#fdfcf7]",
        lead ? "sm:p-7" : "",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-[2px] w-0 transition-all duration-500 group-hover/tile:w-full ${style.line}`}
      />

      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${style.text}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.solid}`} />
          {categoryName(post.category)}
        </span>
        <span className="label-mono flex items-center gap-1.5 text-ink-mute">
          <Clock className="h-3 w-3" strokeWidth={1.8} />
          {post.readingMinutes}분
        </span>
      </div>

      <h3
        className={[
          "mt-4 font-bold tracking-[-0.03em] text-ink",
          lead
            ? "text-[clamp(1.3rem,2vw,1.7rem)] leading-[1.35]"
            : "text-[1.08rem] leading-[1.42]",
        ].join(" ")}
      >
        <Link href={postPath(post.slug)} className="after:absolute after:inset-0">
          {post.title}
        </Link>
      </h3>

      <p
        className={[
          "mt-2.5 text-ink-soft",
          lead
            ? "line-clamp-3 text-[14.5px] leading-[1.72]"
            : "line-clamp-2 text-[13px] leading-[1.65]",
        ].join(" ")}
      >
        {post.description}
      </p>

      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <time dateTime={post.date} className="label-mono text-ink-mute">
            {formatDate(post.date)}
          </time>
          {post.tags.length > 0 ? (
            <>
              <span aria-hidden="true" className="h-2.5 w-px bg-rule" />
              <span className="label-mono truncate text-ink-mute">#{post.tags[0]}</span>
            </>
          ) : null}
        </div>

        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-rule text-ink-mute transition-all duration-300 group-hover/tile:border-ink group-hover/tile:bg-ink group-hover/tile:text-surface"
        >
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
      </div>

      {/* 태그 링크는 칸 전체 링크 위로 올린다. */}
      {post.tags.length > 1 ? (
        <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
          {post.tags.slice(1, 3).map((tag) => (
            <Link
              key={tag}
              href={tagPath(tag)}
              className="rounded border border-rule/80 px-1.5 py-0.5 text-[10.5px] text-ink-mute transition-colors hover:border-ink hover:text-ink"
            >
              #{tag}
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}
