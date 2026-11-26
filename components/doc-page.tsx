import type { ReactNode } from "react";

type Props = {
  eyebrow: string;
  title: string;
  lead?: string;
  meta?: ReactNode;
  children: ReactNode;
};

/** 소개·문의·약관처럼 읽는 문서 페이지의 공통 틀. */
export function DocPage({ eyebrow, title, lead, meta, children }: Props) {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-16 sm:px-8">
      <div className="max-w-[44rem] pt-12 sm:pt-16">
        <p className="label-mono flex items-center gap-2 text-ink-mute">
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-signal" />
          {eyebrow}
        </p>
        <h1 className="mt-4 font-editorial text-[clamp(1.8rem,3.4vw,2.6rem)] font-semibold leading-[1.3] tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {lead ? (
          <p className="mt-4 text-[14px] leading-[1.9] text-ink-soft">{lead}</p>
        ) : null}
        {meta ? <div className="label-mono mt-4 text-ink-mute">{meta}</div> : null}

        <div className="mt-10 border-t border-ink/70 pt-8">{children}</div>
      </div>
    </div>
  );
}
