type JsonLdProps = {
  data: Record<string, unknown> | Record<string, unknown>[];
};

/** 검색엔진용 구조화 데이터 (JSON-LD) */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify 결과를 그대로 넣는다. 사용자 입력이 아닌 빌드 타임 데이터다.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
