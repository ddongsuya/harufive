import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/doc-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description:
    "하루다섯(harufive.kr)의 개인정보처리방침입니다. 수집 항목, 쿠키와 Google AdSense 제3자 광고, 맞춤형 광고 거부 방법을 안내합니다.",
  alternates: { canonical: "/privacy/" },
};

const updated = "2026년 11월 19일";

export default function PrivacyPage() {
  return (
    <DocPage
      eyebrow="개인정보"
      title="개인정보처리방침"
      meta={
        <>
          시행일 {updated} · 운영자 {site.author.name}
        </>
      }
    >
      <div className="article-prose prose max-w-none">
        <p>
          {site.name}(이하 &ldquo;블로그&rdquo;, {site.url})는 이용자의 개인정보를
          소중히 다루며, 「개인정보 보호법」 등 관련 법령을 준수합니다. 이
          방침은 블로그가 어떤 정보를 어떤 목적으로 처리하는지 알려 드립니다.
        </p>

        <h2>1. 처리하는 정보</h2>
        <p>
          블로그는 회원가입 기능이 없으며, 이름·전화번호 같은 정보를 직접
          요구하지 않습니다. 다만 다음 정보가 자동으로 생성·수집될 수 있습니다.
        </p>
        <table>
          <thead>
            <tr>
              <th>구분</th>
              <th>항목</th>
              <th>목적</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>접속 기록</td>
              <td>IP 주소, 브라우저·기기 정보, 방문 일시, 요청한 페이지</td>
              <td>사이트 제공, 오류 대응, 부정 접근 차단</td>
            </tr>
            <tr>
              <td>쿠키·광고 식별자</td>
              <td>Google AdSense 등 제3자가 설정하는 쿠키</td>
              <td>광고 게재 및 광고 성과 측정</td>
            </tr>
            <tr>
              <td>이용자가 보낸 정보</td>
              <td>문의 메일의 주소, 본문, 첨부파일</td>
              <td>문의 응대</td>
            </tr>
          </tbody>
        </table>

        <h2>2. 쿠키와 제3자 광고</h2>
        <p>
          블로그는 Google AdSense를 통해 광고를 게재합니다. Google을 포함한
          제3자 광고 사업자는 쿠키를 사용하여 이용자가 이 사이트나 다른
          사이트를 방문한 기록을 바탕으로 광고를 표시할 수 있습니다.
        </p>
        <ul>
          <li>
            Google은 광고 쿠키(예: DoubleClick 쿠키)를 사용해 이용자의 관심에
            기반한 맞춤형 광고를 제공합니다.
          </li>
          <li>
            이용자는{" "}
            <a
              href="https://www.google.com/settings/ads"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google 광고 설정
            </a>
            에서 맞춤형 광고를 사용 중지할 수 있습니다.
          </li>
          <li>
            제3자 광고 사업자의 맞춤형 광고를 한 번에 거부하려면{" "}
            <a
              href="https://www.aboutads.info/choices/"
              target="_blank"
              rel="noopener noreferrer"
            >
              aboutads.info
            </a>{" "}
            또는{" "}
            <a
              href="https://thenai.org/opt-out/"
              target="_blank"
              rel="noopener noreferrer"
            >
              NAI opt-out
            </a>
            을 이용할 수 있습니다. (미국·유럽 기준 도구이며, 한국에서는 Google
            광고 설정이 가장 확실합니다.)
          </li>
          <li>
            브라우저 설정에서 쿠키를 차단하거나 삭제할 수 있습니다. 다만 쿠키를
            차단하면 일부 기능이나 광고 표시가 달라질 수 있습니다.
          </li>
          <li>
            Google의 데이터 처리 방식은{" "}
            <a
              href="https://policies.google.com/technologies/partner-sites?hl=ko"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google 파트너 사이트 정책
            </a>
            에서 확인할 수 있습니다.
          </li>
        </ul>

        <h2>3. 보관 기간과 파기</h2>
        <p>
          접속 기록은 호스팅 사업자의 정책에 따라 짧게 보관된 뒤 파기됩니다.
          문의 메일은 응대가 끝난 뒤 1년 이내에 삭제하며, 이용자가 삭제를
          요청하면 지체 없이 파기합니다. 법령에서 보관을 요구하는 경우에는 해당
          기간 동안 보관합니다.
        </p>

        <h2>4. 처리의 위탁과 국외 이전</h2>
        <ul>
          <li>
            <strong>호스팅</strong>: GitHub, Inc. (GitHub Pages) — 정적 파일 제공과
            접속 로그 처리.
          </li>
          <li>
            <strong>광고</strong>: Google LLC (Google AdSense) — 광고 게재와 성과
            측정. 쿠키 기반 정보가 미국 등 Google 데이터센터로 이전될 수
            있습니다.
          </li>
        </ul>
        <p>
          위 사업자는 각자의 개인정보처리방침에 따라 정보를 처리합니다. 블로그는
          이들로부터 개별 이용자를 식별할 수 있는 정보를 제공받지 않습니다.
        </p>

        <h2>5. 이용자의 권리</h2>
        <p>
          이용자는 자신의 개인정보 열람·정정·삭제·처리정지를 요구할 수 있습니다.{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>로
          요청하시면 본인 확인 후 10일 이내에 처리 결과를 알려 드립니다.
          맞춤형 광고는 위 2항의 방법으로 언제든지 거부할 수 있습니다.
        </p>

        <h2>6. 아동의 개인정보</h2>
        <p>
          블로그는 만 14세 미만 아동을 대상으로 하지 않으며, 아동의 개인정보를
          의도적으로 수집하지 않습니다. 보호자가 아동의 정보가 수집되었다고
          판단되면 알려 주시기 바랍니다.
        </p>

        <h2>7. 안전성 확보 조치</h2>
        <p>
          블로그는 HTTPS로만 제공되며, 개인정보를 저장하는 자체 데이터베이스를
          운영하지 않습니다. 문의 메일은 접근 권한이 제한된 계정에서만
          확인합니다.
        </p>

        <h2>8. 방침의 변경</h2>
        <p>
          내용이 바뀌면 이 페이지에 변경 사항과 시행일을 게시합니다. 중요한
          변경은 시행 7일 전부터 공지합니다.
        </p>

        <h2>9. 문의처</h2>
        <p>
          개인정보 처리에 관한 문의는{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> (
          {site.author.name})로 보내 주세요. 개인정보 침해에 대한 상담은
          개인정보침해신고센터(국번 없이 118), 개인정보분쟁조정위원회
          (1833-6972)에 문의할 수 있습니다.
        </p>
      </div>

      <p className="mt-10 text-[13px] text-ink-soft">
        함께 보기:{" "}
        <Link href="/terms/" className="underline decoration-rule underline-offset-2 hover:text-ink">
          이용약관
        </Link>{" "}
        ·{" "}
        <Link href="/contact/" className="underline decoration-rule underline-offset-2 hover:text-ink">
          문의하기
        </Link>
      </p>
    </DocPage>
  );
}
