import type { MetadataRoute } from "next";
import { categories, site } from "@/lib/site";
import {
  categoryPath,
  getAllPosts,
  getAllTags,
  postPath,
  tagPath,
} from "@/lib/posts";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  const latestDate = posts[0]?.date ?? new Date().toISOString().slice(0, 10);
  const lastModified = new Date(`${latestDate}T00:00:00+09:00`);

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${site.url}/`,
      lastModified,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${site.url}/posts/`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${site.url}/about/`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${site.url}/contact/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${site.url}/privacy/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${site.url}/terms/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const categoryPages: MetadataRoute.Sitemap = categories.map((category) => ({
    url: `${site.url}${categoryPath(category.slug)}`,
    lastModified,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const postPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${site.url}${postPath(post.slug)}`,
    lastModified: new Date(`${post.updated ?? post.date}T00:00:00+09:00`),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const tagPages: MetadataRoute.Sitemap = getAllTags().map((tag) => ({
    url: `${site.url}${tagPath(tag.name)}`,
    lastModified,
    changeFrequency: "weekly",
    priority: 0.4,
  }));

  return [...staticPages, ...postPages, ...categoryPages, ...tagPages];
}
