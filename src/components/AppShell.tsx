"use client";

import { useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Sidebar from "./Sidebar";
import MarkdownRenderer from "./MarkdownRenderer";
import TableOfContents from "./TableOfContents";
import WelcomeScreen from "./WelcomeScreen";
import { extractHeadings } from "@/lib/toc";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface ContentMeta {
  slug: string;
  title: string;
  category: string;
  order: number;
}

interface CategoryGroup {
  category: string;
  items: ContentMeta[];
}

interface ContentItem extends ContentMeta {
  content: string;
}

interface AppShellProps {
  groups: CategoryGroup[];
}

export default function AppShell({ groups }: AppShellProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [contentData, setContentData] = useState<ContentItem | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tocItems: TocItem[] = contentData ? extractHeadings(contentData.content) : [];

  const handleSelect = useCallback(async (slug: string) => {
    setActiveSlug(slug);
    setLoading(true);
    try {
      const res = await fetch(`/api/content?slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const data = await res.json();
        setContentData(data);
        // Scroll to top when switching content
        setTimeout(() => {
          scrollRef.current?.scrollTo({ top: 0 });
        }, 50);
      }
    } catch (err) {
      console.error("Failed to load content:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="flex h-screen overflow-hidden anime-bg dot-pattern">
      {/* Sidebar */}
      <Sidebar
        groups={groups}
        activeSlug={activeSlug}
        onSelect={handleSelect}
      />

      {/* Main content area */}
      <main className="flex-1 flex overflow-hidden">
        <AnimatePresence mode="wait">
          {!activeSlug ? (
            <WelcomeScreen key="welcome" />
          ) : loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-9 h-9 border-3 border-primary-pale border-t-primary rounded-full animate-spin" />
                <span className="text-xs text-muted font-medium">Loading...</span>
              </div>
            </motion.div>
          ) : contentData ? (
            <motion.div
              key={contentData.slug}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex overflow-hidden"
            >
              {/* Article */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-8 py-8 lg:px-12 lg:py-10"
              >
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-xs font-medium text-muted mb-6">
                  <span className="px-2 py-0.5 rounded-full bg-primary-pale text-primary text-[11px] font-semibold">{contentData.category}</span>
                  <span className="text-border-hover">/</span>
                  <span>{contentData.title}</span>
                </div>
                <MarkdownRenderer content={contentData.content} />
                <div className="h-20" />
              </div>

              {/* TOC */}
              <TableOfContents items={tocItems} scrollContainerRef={scrollRef} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
}
