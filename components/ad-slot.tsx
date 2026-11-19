"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** AdSense 광고 단위 ID. 없으면 아무것도 렌더하지 않는다. */
  slot: string;
  format?: "auto" | "fluid" | "rectangle";
  layout?: "in-article" | "display";
  className?: string;
  label?: string;
};

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * 애드센스 광고 슬롯.
 *
 * `NEXT_PUBLIC_ADSENSE_CLIENT` 또는 슬롯 ID가 설정되지 않은 빌드에서는
 * 아무 마크업도 만들지 않으므로, 승인 전에도 안전하게 배포할 수 있다.
 */
export function AdSlot({
  slot,
  format = "auto",
  layout,
  className = "",
  label = "광고",
}: Props) {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "";
  const enabled = Boolean(client && slot);
  const pushed = useRef(false);

  useEffect(() => {
    if (!enabled || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      // 스크립트가 아직 로드되지 않은 경우 다음 렌더에서 다시 시도된다.
    }
  }, [enabled]);

  if (!enabled) return null;

  return (
    <aside aria-label={label} className={`ad-slot my-8 ${className}`}>
      <p className="mb-1 text-center text-[10px] uppercase tracking-widest text-ink-mute">
        {label}
      </p>
      <ins
        className="adsbygoogle block"
        style={{ display: "block" }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={format}
        data-ad-layout={layout}
        data-full-width-responsive="true"
      />
    </aside>
  );
}
