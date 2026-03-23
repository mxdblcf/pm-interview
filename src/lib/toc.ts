import GithubSlugger from "github-slugger";

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

/**
 * Extract headings from raw markdown content for TOC generation
 */
export function extractHeadings(markdown: string): TocItem[] {
  const headingRegex = /^(#{1,4})\s+(.+?)(?:\s+#+\s*)?$/gm;
  const headings: TocItem[] = [];
  const slugger = new GithubSlugger();

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2]
      .trim()
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!text) continue;

    headings.push({ id: slugger.slug(text), text, level });
  }

  return headings;
}
