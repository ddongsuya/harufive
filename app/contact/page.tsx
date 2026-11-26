import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";
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
    <DocPage
      eyebrow="문의"
      title="문의하기"
      lead="블로그에 관한 문의는 아래 메일로 보내 주세요. 영업일 기준 2~3일 안에 답장 드립니다."
    >
      <div className="border border-rule bg-surface p-6">
        <p className="label-mono text-ink-mute">이메일</p>
        <a
          href={`mailto:${site.contactEmail}?subject=${encodeURIComponent(
            "[하루다섯] 문의",
          )}`}
          className="mt-2 inline-block font-editorial text-[1.35rem] font-semibold tracking-[-0.02em] text-ink underline decoration-signal/40 underline-offset-4 transition-colors hover:decoration-signal"
        >
          {site.contactEmail}
        </a>
        <p className="mt-4 text-[13px] leading-[1.8] text-ink-soft">
          메일에 아래 내용을 함께 적어 주시면 더 빠르게 확인할 수 있습니다.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-[1.8] text-ink-soft">
          <li>문의 종류(정정 / 주제 제안 / 협업 / 기타)</li>
          <li>관련 글 주소(있는 경우)</li>
          <li>확인이 필요한 근거 자료(있는 경우)</li>
        </ul>
      </div>

      <div className="mt-10 border-t border-rule">
        {topics.map((topic, index) => (
          <div
            key={topic.title}
            className="flex gap-4 border-b border-rule py-5 sm:gap-6"
          >
            <span className="shrink-0 pt-0.5 font-mono text-[9.5px] tabular-nums tracking-[0.1em] text-signal">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 className="font-editorial text-[1.02rem] font-semibold tracking-[-0.01em] text-ink">
                {topic.title}
              </h2>
              <p className="mt-1.5 text-[13px] leading-[1.85] text-ink-soft">
                {topic.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[12px] leading-relaxed text-ink-mute">
        개인정보 처리에 관한 문의는{" "}
        <a href="/privacy/" className="underline decoration-rule underline-offset-2 hover:text-ink">
          개인정보처리방침
        </a>
        을 먼저 확인해 주세요. 블로그는 회원가입·로그인 기능이 없으며, 문의
        과정에서 받은 정보는 응대 목적으로만 사용합니다.
      </p>
    </DocPage>
  );
}
