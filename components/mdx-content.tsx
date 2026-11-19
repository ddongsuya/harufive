import type { AnchorHTMLAttributes, ComponentPropsWithoutRef } from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { Callout } from "./callout";

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
    <div className="my-6 overflow-x-auto rounded-lg border border-line">
      <table className="my-0 w-full border-collapse" {...props} />
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
      className="rounded-xl border border-line"
      {...rest}
    />
  );
}

const components = {
  a: MdxLink,
  table: MdxTable,
  img: MdxImage,
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
