import Link from "next/link";
import { categoryName } from "@/lib/site";
import { formatDate, postPath, type Post } from "@/lib/posts";

type Props = {
  post: Post;
  featured?: boolean;
};

export function PostCard({ post, featured = false }: Props) {
  return (
    <article
      className={[
        "group relative rounded-2xl border border-line bg-paper p-5 transition-colors",
        "hover:border-brand/40 hover:shadow-[0_6px_24px_-16px_rgba(15,107,92,0.45)]",
        featured ? "sm:p-7" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-mute">
        <Link
          href={`/categories/${post.category}/`}
          className="relative z-10 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-dark transition-colors hover:bg-brand hover:text-white"
        >
          {categoryName(post.category)}
        </Link>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        <span aria-hidden="true">·</span>
        <span>{post.readingMinutes}분 읽기</span>
      </div>

      <h3
        className={[
          "mt-3 font-semibold tracking-tight text-ink",
          featured ? "text-2xl leading-snug sm:text-[1.7rem]" : "text-lg leading-snug",
        ].join(" ")}
      >
        <Link href={postPath(post.slug)} className="after:absolute after:inset-0">
          {post.title}
        </Link>
      </h3>

      <p
        className={[
          "mt-2 text-ink-soft",
          featured ? "text-[15px] leading-relaxed" : "text-sm leading-relaxed",
        ].join(" ")}
      >
        {post.description}
      </p>

      {post.tags.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {post.tags.slice(0, 3).map((tag) => (
            <li
              key={tag}
              className="rounded border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink-mute"
            >
              #{tag}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
