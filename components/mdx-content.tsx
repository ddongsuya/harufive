import type { AnchorHTMLAttributes, ComponentPropsWithoutRef } from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { Callout } from "./callout";
import { CodeBlock } from "./code-block";

function MdxLink({ href = "", children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal = /^https?:\/\//.test(href);

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }

  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function MdxTable(props: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="my-7">
      <div className="overflow-x-auto">
        <table className="my-0 w-full min-w-[30rem] border-collapse" {...props} />
      </div>
      <p className="mt-2 font-mono text-[10px] tracking-[0.04em] text-ink-mute sm:hidden">
        표가 넓어 옆으로 넘겨 볼 수 있습니다.
      </p>
    </div>
  );
}

function MdxImage(props: ComponentPropsWithoutRef<"img">) {
  const { alt = "", ...rest } = props;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      loading="lazy"
      decoding="async"
      className="border border-rule"
      {...rest}
    />
  );
}

const components = {
  a: MdxLink,
  table: MdxTable,
  img: MdxImage,
  pre: CodeBlock,
  Callout,
};

export function MdxContent({ source }: { source: string }) {
  return (
    <MDXRemote
      source={source}
      components={components}
      options={{
        parseFrontmatter: false,
        mdxOptions: {
          remarkPlugins: [remarkGfm],
          rehypePlugins: [
            rehypeSlug,
            [
              rehypeAutolinkHeadings,
              {
                behavior: "wrap",
                properties: { className: ["heading-anchor"] },
              },
            ],
          ],
        },
      }}
    />
  );
}
