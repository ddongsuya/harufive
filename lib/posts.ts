import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import GithubSlugger from "github-slugger";
import { site } from "./site";
import { tagSlug } from "./urls";

const POSTS_DIR = path.join(process.cwd(), "content", "posts");

export type TocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  category: string;
  tags: string[];
  author: string;
  featured: boolean;
};

export type Post = PostMeta & {
  content: string;
  toc: TocItem[];
  readingMinutes: number;
  characterCount: number;
};

/** 화면(클라이언트 컴포넌트)에 건네는 요약본. 본문·목차는 담지 않는다. */
export type PostSummary = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  category: string;
  tags: string[];
  author: string;
  featured: boolean;
  readingMinutes: number;
};

export function toSummary(post: Post): PostSummary {
  return {
    slug: post.slug,
    title: post.title,
    description: post.description,
    date: post.date,
    updated: post.updated,
    category: post.category,
    tags: post.tags,
    author: post.author,
    featured: post.featured,
    readingMinutes: post.readingMinutes,
  };
}

type Frontmatter = {
  title?: string;
  description?: string;
  date?: string | Date;
  updated?: string | Date;
  category?: string;
  tags?: string[];
  author?: string;
  featured?: boolean;
  draft?: boolean;
};

function toIsoDate(value: string | Date | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** 마크다운 서식 기호를 걷어내 제목 텍스트만 남긴다. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * 본문에서 h2·h3 를 뽑아 목차를 만든다.
 * rehype-slug 와 같은 github-slugger 를 쓰므로 실제 앵커 id 와 일치한다.
 */
export function extractToc(source: string): TocItem[] {
  const slugger = new GithubSlugger();
  const toc: TocItem[] = [];
  let inFence = false;

  for (const line of source.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;

    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;

    toc.push({
      id: slugger.slug(text),
      text,
      level: match[1].length === 2 ? 2 : 3,
    });
  }

  return toc;
}

/** 한국어 글자 수와 영문 단어 수를 함께 고려한 대략적인 읽기 시간. */
export function estimateReading(source: string): {
  minutes: number;
  characters: number;
} {
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|-]/g, " ");
  const korean = (text.match(/[\uac00-\ud7a3]/g) ?? []).length;
  const latinWords = (text.match(/[A-Za-z][A-Za-z0-9'-]*/g) ?? []).length;
  const minutes = Math.max(
    1,
    Math.round(korean / 450 + latinWords / 200),
  );
  return { minutes, characters: korean + latinWords };
}

function readPostFile(fileName: string): Post | null {
  const filePath = path.join(POSTS_DIR, fileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  const front = data as Frontmatter;

  if (!front.title || !front.date) return null;
  if (front.draft && process.env.NODE_ENV === "production") return null;

  const slug = fileName.replace(/\.mdx?$/, "");
  const reading = estimateReading(content);

  return {
    slug,
    title: front.title,
    description: front.description ?? "",
    date: toIsoDate(front.date),
    updated: front.updated ? toIsoDate(front.updated) : undefined,
    category: front.category ?? "ai-basics",
    tags: front.tags ?? [],
    author: front.author ?? site.author.name,
    featured: Boolean(front.featured),
    content,
    toc: extractToc(content),
    readingMinutes: reading.minutes,
    characterCount: reading.characters,
  };
}

let cache: Post[] | null = null;

export function getAllPosts(): Post[] {
  if (cache) return cache;
  if (!fs.existsSync(POSTS_DIR)) {
    cache = [];
    return cache;
  }

  const posts = fs
    .readdirSync(POSTS_DIR)
    .filter((file) => /\.mdx?$/.test(file))
    .map(readPostFile)
    .filter((post): post is Post => post !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  cache = posts;
  return posts;
}

export function getPost(slug: string): Post | undefined {
  return getAllPosts().find((post) => post.slug === slug);
}

export function getPostsByCategory(category: string): Post[] {
  return getAllPosts().filter((post) => post.category === category);
}

export function getPostsByTag(tag: string): Post[] {
  return getAllPosts().filter((post) => post.tags.includes(tag));
}

export type TagInfo = { name: string; slug: string; count: number };

export function getAllTags(): TagInfo[] {
  const counts = new Map<string, number>();
  for (const post of getAllPosts()) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, slug: tagSlug(name), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** 같은 카테고리 글을 먼저, 그다음 태그가 겹치는 글을 이어 붙인다. */
export function getRelatedPosts(post: Post, limit = 3): Post[] {
  const others = getAllPosts().filter((item) => item.slug !== post.slug);
  const score = (item: Post) => {
    const sharedTags = item.tags.filter((tag) => post.tags.includes(tag)).length;
    return (item.category === post.category ? 10 : 0) + sharedTags;
  };

  return others
    .map((item) => ({ item, score: score(item) }))
    .sort((a, b) => b.score - a.score || (a.item.date < b.item.date ? 1 : -1))
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function getAdjacentPosts(post: Post): {
  newer?: Post;
  older?: Post;
} {
  const posts = getAllPosts();
  const index = posts.findIndex((item) => item.slug === post.slug);
  return {
    newer: index > 0 ? posts[index - 1] : undefined,
    older: index >= 0 ? posts[index + 1] : undefined,
  };
}

export {
  absoluteUrl,
  categoryPath,
  formatDate,
  postPath,
  tagPath,
  tagSlug,
} from "./urls";
