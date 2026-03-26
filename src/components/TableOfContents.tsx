"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListTree, X } from "lucide-react";
import clsx from "clsx";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  items: TocItem[];
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export default function TableOfContents({ items, scrollContainerRef }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (items.length === 0) return;

    const root = scrollContainerRef?.current ?? null;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible heading
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        root,
        rootMargin: "-60px 0px -70% 0px",
        threshold: 0.1,
      }
    );

    // Small delay to let DOM settle after content switch
    const timer = setTimeout(() => {
      const headingElements = items
        .map((item) => document.getElementById(item.id))
        .filter(Boolean) as HTMLElement[];

      headingElements.forEach((el) => observer.observe(el));
    }, 100);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [items, scrollContainerRef]);

  if (items.length === 0) return null;

  const minLevel = Math.min(...items.map((i) => i.level));

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el && scrollContainerRef?.current) {
      const container = scrollContainerRef.current;
      const offsetTop = el.offsetTop - container.offsetTop;
      container.scrollTo({
        top: offsetTop - 60,
        behavior: "smooth",
      });
    } else {
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setMobileOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-surface/95 px-4 py-2.5 text-sm font-semibold text-foreground shadow-xl shadow-primary/[0.08] backdrop-blur-md transition-colors hover:bg-surface-hover"
        aria-expanded={mobileOpen}
        aria-controls="mobile-toc-panel"
      >
        <ListTree className="h-4 w-4 text-primary" />
        On this page
      </button>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 z-50"
          >
            <button
              type="button"
              aria-label="Close table of contents"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            />
            <motion.div
              id="mobile-toc-panel"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-x-4 bottom-4 max-h-[70vh] overflow-hidden rounded-[28px] border border-border bg-surface/95 shadow-2xl shadow-primary/[0.08] backdrop-blur-xl"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h4 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
                  <span>📑</span> On this page
                </h4>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  aria-label="Close table of contents panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[calc(70vh-3.75rem)] overflow-y-auto p-3">
                <div className="space-y-0.5 border-l-2 border-primary-pale">
                  {items.map((item) => {
                    const indent = (item.level - minLevel) * 12;
                    const isActive = activeId === item.id;

                    return (
                      <a
                        key={`mobile-${item.id}`}
                        href={`#${item.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          scrollToHeading(item.id);
                        }}
                        style={{ paddingLeft: `${indent + 12}px` }}
                        className={clsx(
                          "block py-2 pr-3 text-sm transition-all duration-200 border-l-2 -ml-px rounded-r-md",
                          isActive
                            ? "text-primary border-primary font-semibold bg-primary-pale/50"
                            : "text-muted hover:text-foreground border-transparent hover:border-primary-light"
                        )}
                      >
                        {item.text}
                      </a>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.nav
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="hidden lg:block w-[220px] flex-shrink-0 py-8 pr-4"
      >
        <div className="sticky top-8 max-h-[calc(100vh-6rem)] overflow-y-auto">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary mb-4 px-3 flex items-center gap-1.5">
            <span>📑</span> On this page
          </h4>
          <div className="space-y-0.5 border-l-2 border-primary-pale">
            {items.map((item) => {
              const indent = (item.level - minLevel) * 12;
              const isActive = activeId === item.id;

              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToHeading(item.id);
                  }}
                  style={{ paddingLeft: `${indent + 12}px` }}
                  className={clsx(
                    "block py-1.5 pr-3 text-xs transition-all duration-200 border-l-2 -ml-px rounded-r-md",
                    isActive
                      ? "text-primary border-primary font-semibold bg-primary-pale/50"
                      : "text-muted hover:text-foreground border-transparent hover:border-primary-light"
                  )}
                >
                  {item.text}
                </a>
              );
            })}
          </div>
        </div>
      </motion.nav>
    </>
  );
}
