import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-24 text-center sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        404
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        주소가 바뀌었거나 삭제된 글일 수 있습니다. 아래 링크에서 다시 찾아보세요.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          홈으로
        </Link>
        <Link
          href="/posts/"
          className="rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-dark"
        >
          글 전체 보기
        </Link>
      </div>
    </div>
  );
}
