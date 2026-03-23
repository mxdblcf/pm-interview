"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
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

  return (
    <motion.nav
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="hidden xl:block w-[220px] flex-shrink-0 py-8 pr-4"
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
                  const el = document.getElementById(item.id);
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
  );
}
