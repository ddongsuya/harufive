import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/doc-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "이용약관",
  description:
    "하루다섯(harufive.kr) 콘텐츠의 이용 조건과 저작권, 광고 게재, 면책 사항을 안내합니다.",
  alternates: { canonical: "/terms/" },
};

const updated = "2026년 11월 19일";

export default function TermsPage() {
  return (
    <DocPage eyebrow="약관" title="이용약관" meta={<>시행일 {updated}</>}>
      <div className="article-prose prose max-w-none">
        <h2>1. 목적</h2>
        <p>
          이 약관은 {site.name}({site.url}, 이하 &ldquo;블로그&rdquo;)가 제공하는
          콘텐츠의 이용 조건과 절차를 정하는 것을 목적으로 합니다.
        </p>

        <h2>2. 콘텐츠의 저작권</h2>
        <p>
          블로그에 게시된 글, 표, 이미지의 저작권은 운영자 {site.author.name}에게
          있습니다. 다음 경우를 제외하고는 사전 허락 없이 복제·배포·2차적
          이용을 할 수 없습니다.
        </p>
        <ul>
          <li>출처({site.url})와 원문 링크를 명시한 짧은 인용</li>
          <li>개인적 학습 목적의 열람·인쇄</li>
          <li>검색엔진·AI 학습 목적의 정상적인 크롤링</li>
        </ul>

        <h2>3. 정보의 성격과 한계</h2>
        <p>
          블로그의 글은 작성 시점에 확인한 정보를 바탕으로 한 일반적인 안내이며,
          특정 도구의 가격·기능·정책은 예고 없이 바뀔 수 있습니다. 투자·법률·세무
          등 전문적 판단이 필요한 사안은 반드시 해당 전문가의 확인을 받으시기
          바랍니다.
        </p>

        <h2>4. 광고 게재</h2>
        <p>
          블로그는 Google AdSense 등 제3자 광고를 게재할 수 있습니다. 광고
          영역에는 &lsquo;광고&rsquo; 표시를 하며, 광고 내용은 광고주가 제공하는
          것으로 블로그의 의견을 대변하지 않습니다. 쿠키와 맞춤형 광고에 대한
          안내는{" "}
          <Link href="/privacy/">개인정보처리방침</Link>을 확인해 주세요.
        </p>

        <h2>5. 금지 행위</h2>
        <ul>
          <li>블로그 콘텐츠를 대량으로 복제·재배포하거나 유료로 판매하는 행위</li>
          <li>서비스 운영을 방해하는 과도한 요청, 자동화된 스크래핑</li>
          <li>타인의 권리를 침해하는 방식으로 콘텐츠를 이용하는 행위</li>
        </ul>

        <h2>6. 책임의 제한</h2>
        <p>
          블로그는 콘텐츠의 정확성을 높이기 위해 노력하지만, 이용자가 블로그의
          정보를 근거로 내린 결정과 그 결과에 대해서는 책임을 지지 않습니다.
          콘텐츠 이용 중 발생한 손해에 대해 법령이 허용하는 범위에서 책임을
          지지 않습니다.
        </p>

        <h2>7. 외부 링크</h2>
        <p>
          블로그에는 외부 사이트 링크가 포함될 수 있습니다. 외부 사이트의 내용과
          개인정보 처리에는 해당 사이트의 정책이 적용되며, 블로그는 그에 대해
          통제하지 않습니다.
        </p>

        <h2>8. 약관의 변경</h2>
        <p>
          약관이 변경되면 이 페이지에 변경 내용과 시행일을 게시합니다. 변경 후에도
          블로그를 계속 이용하면 변경된 약관에 동의한 것으로 봅니다.
        </p>

        <h2>9. 문의</h2>
        <p>
          약관과 콘텐츠 이용에 관한 문의는{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>로 보내
          주세요.
        </p>
      </div>
    </DocPage>
  );
}
