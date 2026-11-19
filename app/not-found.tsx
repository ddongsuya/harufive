import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
      <div className="max-w-[46rem] pt-20 pb-10">
        <p className="label-mono flex items-center gap-2 text-ink-mute">
          <span aria-hidden="true" className="h-px w-6 bg-signal" />
          404
        </p>
        <h1 className="mt-4 text-[clamp(1.7rem,3.2vw,2.4rem)] font-bold leading-[1.25] tracking-[-0.04em] text-ink">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="mt-3.5 max-w-md text-[13.5px] leading-[1.8] text-ink-soft">
          주소가 바뀌었거나 삭제된 글일 수 있습니다. 아래에서 다시 찾아보세요.
        </p>

        <div className="mt-8 flex flex-wrap gap-2.5">
          <Link
            href="/"
            className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-surface transition-colors hover:bg-ink/90"
          >
            홈으로
          </Link>
          <Link
            href="/posts/"
            className="inline-flex items-center gap-1.5 rounded-full border border-rule px-5 py-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            글 전체 보기
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </div>
  );
}
