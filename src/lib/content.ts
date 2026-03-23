import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface ContentMeta {
  slug: string;
  title: string;
  category: string;
  order: number;
  fileName: string;
}

export interface ContentItem extends ContentMeta {
  content: string;
}

export interface CategoryGroup {
  category: string;
  items: ContentMeta[];
}

const contentDirectory = path.join(process.cwd(), "content");

/**
 * Scan /content subdirectories. Each subfolder = a category.
 * Files inside each subfolder become menu items.
 */
export function getContentGroupedByCategory(): CategoryGroup[] {
  if (!fs.existsSync(contentDirectory)) return [];

  const entries = fs.readdirSync(contentDirectory, { withFileTypes: true });
  const groups: CategoryGroup[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const categoryDir = path.join(contentDirectory, entry.name);
    const files = fs.readdirSync(categoryDir).filter((f) => f.endsWith(".md"));

    const items: ContentMeta[] = files.map((file) => {
      const filePath = path.join(categoryDir, file);
      const raw = fs.readFileSync(filePath, "utf8");
      const { data } = matter(raw);

      // slug = "Category/filename" so we can locate it later
      const slug = `${entry.name}/${file.replace(/\.md$/, "")}`;

      return {
        slug,
        fileName: file.replace(/\.md$/, ""),
        title: (data.title as string) || file.replace(/\.md$/, "").replace(/-/g, " "),
        category: entry.name,
        order: (data.order as number) || 999,
      };
    });

    items.sort((a, b) => a.order - b.order);

    if (items.length > 0) {
      groups.push({ category: entry.name, items });
    }
  }

  return groups;
}

/**
 * Get a single content item by slug (format: "Category/filename")
 */
export function getContentBySlug(slug: string): ContentItem | null {
  const filePath = path.join(contentDirectory, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  const parts = slug.split("/");
  const category = parts[0];
  const fileName = parts[parts.length - 1];

  return {
    slug,
    fileName,
    title: (data.title as string) || fileName.replace(/-/g, " "),
    category,
    order: (data.order as number) || 999,
    content,
  };
}
