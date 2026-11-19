import type { Metadata } from "next";
import Link from "next/link";
import { categories, site } from "@/lib/site";

export const metadata: Metadata = {
  title: "블로그 소개",
  description:
    "하루다섯(harufive.kr)은 AI 툴과 자동화로 반복 업무를 줄이는 방법을 정리하는 한국어 블로그입니다. 운영자 임정모의 소개와 편집 원칙을 안내합니다.",
  alternates: { canonical: "/about/" },
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        About
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">
        하루다섯은 어떤 블로그인가
      </h1>

      <div className="article-prose prose mt-8 max-w-none">
        <p>
          <strong>하루다섯(harufive.kr)</strong>은 AI 도구와 자동화로 하루의
          반복 업무를 다섯 번, 다섯 분씩이라도 줄이는 방법을 정리하는
          블로그입니다. 이름은 &ldquo;하루에 다섯&rdquo;에서 가져왔습니다. 한
          번에 거대한 시스템을 만드는 대신, 매일 조금씩 반복을 덜어내는 쪽을
          믿습니다.
        </p>

        <h2>무엇을 쓰나</h2>
        <p>
          ChatGPT, Claude, Gemini 같은 대화형 AI를 실무에서 어떻게 쓰는지,
          프롬프트를 어떻게 문서처럼 관리하는지, Zapier·Make·Apps Script 같은
          도구로 어떤 반복을 없앨 수 있는지를 다룹니다. 특정 제품의 홍보 글이
          아니라, 직접 써 보고 남은 판단과 절차를 적습니다.
        </p>

        <table>
          <thead>
            <tr>
              <th>카테고리</th>
              <th>다루는 내용</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.slug}>
                <td>
                  <Link href={`/categories/${category.slug}/`}>
                    {category.name}
                  </Link>
                </td>
                <td>{category.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>운영자</h2>
        <p>
          <strong>{site.author.name}</strong> ({site.author.role})이 쓰고
          운영합니다. 예비 창업자로서 1인 운영에서 반복 업무를 줄이는 방법을
          직접 실험하고, 실패한 시도까지 남깁니다. 글에 대한 정정 요청이나
          다루었으면 하는 주제는{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>로
          보내 주시면 확인 후 반영합니다.
        </p>

        <h2>편집 원칙</h2>
        <ol>
          <li>
            <strong>직접 확인한 것만 씁니다.</strong> 화면, 가격, 무료 한도처럼
            바뀌기 쉬운 정보는 확인한 시점을 함께 적습니다.
          </li>
          <li>
            <strong>광고와 본문을 구분합니다.</strong> 애드센스 광고는
            &lsquo;광고&rsquo; 표시가 있는 영역에만 게재하며, 본문 내용에 영향을
            주지 않습니다.
          </li>
          <li>
            <strong>저작권을 지킵니다.</strong> 남의 글을 복사하지 않고, 인용할
            때는 출처를 밝힙니다. 이미지는 직접 만들거나 사용 조건이 명확한
            것만 씁니다.
          </li>
          <li>
            <strong>틀린 것은 고칩니다.</strong> 내용이 바뀌면 글을 새로 쓰지
            않고 수정일을 남겨 갱신합니다.
          </li>
        </ol>

        <h2>이 블로그의 기술</h2>
        <p>
          Next.js 정적 내보내기로 만들어 GitHub Pages에서 제공하며, 광고는 Google
          AdSense로 게재합니다. 별도 회원가입이나 로그인은 없습니다. 자세한
          내용은{" "}
          <Link href="/privacy/">개인정보처리방침</Link>과{" "}
          <Link href="/terms/">이용약관</Link>을 참고해 주세요.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/posts/"
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          글 전체 보기
        </Link>
        <Link
          href="/contact/"
          className="rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-dark"
        >
          문의하기
        </Link>
      </div>
    </div>
  );
}
