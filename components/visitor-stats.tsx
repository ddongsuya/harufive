"use client";

import { useEffect, useState } from "react";
import { loadVisitorStats, peekVisitorStats } from "@/lib/visitor-stats";

/** 오늘 방문자는 두 자리로 맞춰 눈금처럼 보이게 한다. (01, 09, 12) */
const pad = (value: number) => (value < 100 ? String(value).padStart(2, "0") : String(value));
/** 전체 방문자는 네 자리가 넘으면 쉼표로 끊는다. (1,284) */
const group = (value: number) => value.toLocaleString("ko-KR");

type Shown = { today: number | null; total: number | null };

/**
 * `Today 01 · Total 1,284` — 방문자 수 한 줄.
 * 헤더와 푸터가 같은 컴포넌트를 쓴다. 요청은 lib 쪽에서 한 번만 나간다.
 * 집계 서비스가 응답하지 않으면 마지막으로 확인된 값을, 그것도 없으면 `--` 를 보여 준다.
 */
export function VisitorStats({ className = "" }: { className?: string }) {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let alive = true;

    const cached = peekVisitorStats();
    if (cached) setShown(cached);

    loadVisitorStats()
      .then((stats) => {
        if (alive) setShown({ today: stats.today, total: stats.total });
      })
      .catch(() => {
        /* 화면은 마지막으로 확인된 값 그대로 둔다. */
      });

    return () => {
      alive = false;
    };
  }, []);

  const cells: Array<{ label: string; value: number | null; format: (v: number) => string }> = [
    { label: "Today", value: shown?.today ?? null, format: pad },
    { label: "Total", value: shown?.total ?? null, format: group },
  ];

  return (
    <dl
      aria-label="방문자 수"
      title="오늘 방문자 · 전체 방문자"
      className={`flex items-baseline gap-2 font-mono text-[10.5px] uppercase leading-none tracking-[0.08em] text-ink-mute ${className}`}
    >
      {cells.map((cell, index) => (
        <div key={cell.label} className="flex items-baseline gap-1.5">
          {index > 0 ? (
            <span aria-hidden="true" className="pr-0.5 text-rule">
              ·
            </span>
          ) : null}
          <dt>{cell.label}</dt>
          <dd className="inline-block min-w-[2ch] tabular-nums tracking-[0.04em] text-ink">
            {cell.value === null ? "--" : cell.format(cell.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
