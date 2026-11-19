import type { Metadata } from "next";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "문의하기",
  description:
    "하루다섯 운영자에게 글 정정, 주제 제안, 협업을 문의하는 방법을 안내합니다.",
  alternates: { canonical: "/contact/" },
};

const topics = [
  {
    title: "글 정정·오류 신고",
    body: "잘못된 정보나 바뀐 가격·기능을 발견하셨다면 해당 글 주소와 함께 알려 주세요. 확인 후 본문에 수정일과 함께 반영합니다.",
  },
  {
    title: "다뤄 주길 바라는 주제",
    body: "현재 막혀 있는 업무 자동화 상황을 한두 문장으로 적어 보내 주시면, 실제 사례 형태로 정리해 글을 씁니다.",
  },
  {
    title: "협업·광고 문의",
    body: "제품 소개나 협업 제안은 사실 확인이 가능한 자료와 함께 보내 주세요. 모든 제안을 수락하지는 않으며, 수락한 경우에도 광고임을 표시합니다.",
  },
];

export default function ContactPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        Contact
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">
        문의하기
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
        블로그에 관한 문의는 아래 메일로 보내 주세요. 영업일 기준 2~3일 안에
        답장 드립니다.
      </p>

      <div className="mt-8 rounded-2xl border border-line bg-paper-alt/60 p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
          이메일
        </p>
        <a
          href={`mailto:${site.contactEmail}?subject=${encodeURIComponent(
            "[하루다섯] 문의",
          )}`}
          className="mt-2 inline-block text-xl font-semibold text-brand-dark underline decoration-brand/30 underline-offset-4 hover:decoration-brand"
        >
          {site.contactEmail}
        </a>
        <p className="mt-4 text-sm text-ink-soft">
          메일에 아래 내용을 함께 적어 주시면 더 빠르게 확인할 수 있습니다.
        </p>
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          <li>· 문의 종류(정정 / 주제 제안 / 협업 / 기타)</li>
          <li>· 관련 글 주소(있는 경우)</li>
          <li>· 확인이 필요한 근거 자료(있는 경우)</li>
        </ul>
      </div>

      <div className="mt-8 grid gap-4">
        {topics.map((topic) => (
          <div
            key={topic.title}
            className="rounded-xl border border-line p-5"
          >
            <h2 className="text-base font-semibold text-ink">{topic.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {topic.body}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-ink-mute">
        개인정보 처리에 관한 문의는{" "}
        <a href="/privacy/" className="underline">
          개인정보처리방침
        </a>
        을 먼저 확인해 주세요. 블로그는 회원가입·로그인 기능이 없으며, 문의
        과정에서 받은 정보는 응대 목적으로만 사용합니다.
      </p>
    </div>
  );
}
