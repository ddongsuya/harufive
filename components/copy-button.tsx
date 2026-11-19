"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  /** 아이콘만 표시 */
  iconOnly?: boolean;
};

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 대체 경로로 넘어간다.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 값 하나를 클립보드로 복사하고, 눌린 순간을 화면에서 확인시켜 준다. */
export function CopyButton({
  value,
  label = "복사",
  copiedLabel = "복사됨",
  className = "",
  iconOnly = false,
}: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onClick = async () => {
    const ok = await writeClipboard(value);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
        copied
          ? "border-jade/40 bg-jade/10 text-jade"
          : "border-rule text-ink-soft hover:border-ink hover:text-ink",
        iconOnly ? "h-7 w-7 justify-center px-0" : "",
        className,
      ].join(" ")}
      aria-label={copied ? copiedLabel : label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />
      )}
      {iconOnly ? null : <span>{copied ? copiedLabel : label}</span>}
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}
