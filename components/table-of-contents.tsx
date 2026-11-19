import type { TocItem } from "@/lib/posts";

export function TableOfContents({ items }: { items: TocItem[] }) {
  if (items.length < 2) return null;

  return (
    <nav aria-label="목차" className="text-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
        목차
      </p>
      <ol className="mt-3 space-y-1.5 border-l border-line">
        {items.map((item) => (
          <li
            key={item.id}
            className={item.level === 3 ? "pl-6" : "pl-3"}
          >
            <a
              href={`#${item.id}`}
              className="block border-l-2 border-transparent py-0.5 pl-2 -ml-[1px] text-ink-soft transition-colors hover:border-brand hover:text-brand-dark"
            >
              {item.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
