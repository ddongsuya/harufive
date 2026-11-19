"use client";

import { Children, isValidElement, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  children?: ReactNode;
};

function detectLanguage(children: ReactNode): string {
  const first = Children.toArray(children)[0];
  if (isValidElement<{ className?: string }>(first)) {
    const match = /language-([\w-]+)/.exec(first.props.className ?? "");
    if (match) return match[1];
  }
  return "code";
}

/**
 * 본문의 코드·프롬프트 상자. 값은 화면의 글자 그대로 복사된다.
 * (프롬프트를 매번 긁어 옮기지 않아도 되도록 복사 단추를 항상 붙여 둔다.)
 */
export function CodeBlock({ children }: Props) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = detectLanguage(children);

  const copy = async () => {
    const text = ref.current?.innerText ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-7 overflow-hidden rounded-xl border border-deep-2 bg-deep">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <span className="label-mono text-surface/45">{language}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "복사됨" : "이 상자 복사"}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-surface/70 transition-colors hover:border-surface/50 hover:text-surface"
        >
          {copied ? (
            <Check className="h-3 w-3 text-[#7fd1b2]" strokeWidth={2.4} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={2} />
          )}
          {copied ? "복사됨" : "복사"}
        </button>
      </div>

      <pre
        ref={ref}
        className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.75] text-[#e9ece4]"
      >
        {children}
      </pre>
    </div>
  );
}
