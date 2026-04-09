"use client";

import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useState } from "react";
import {
  ChevronDown,
  FileText,
  Menu,
  X,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";

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

interface SidebarProps {
  groups: CategoryGroup[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
}

const categoryEmoji: Record<string, string> = {
  JavaScript: "⚡",
  React: "⚛️",
  TypeScript: "💎",
  Network: "🌐",
  Storage: "💽",
  Cloud: "☁️",
  Algorithm: "🧩",
  CSS: "🎨",
  Node: "🍀",
  Database: "📦",
  OperatingSystem: "🖥️",
  软件功能: "🧰",
};

const categoryVariants: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: "auto",
    opacity: 1,
    transition: { duration: 0.25, ease: "easeOut" },
  },
};

export default function Sidebar({
  groups,
  activeSlug,
  onSelect,
}: SidebarProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.category))
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleSelect = (slug: string) => {
    onSelect(slug);
    setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md shadow-primary/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-extrabold text-foreground tracking-tight">
              PM Interview
            </h1>
            <p className="text-[10px] text-muted font-medium tracking-widest uppercase">
              ✨ Toolbox
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {groups.map((group) => (
          <div key={group.category}>
            {/* Category Header */}
            <button
              onClick={() => toggleCategory(group.category)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-muted hover:text-primary hover:bg-primary-pale transition-all duration-200"
            >
              <span className="flex items-center gap-2">
                <span className="text-sm">{categoryEmoji[group.category] || "📁"}</span>
                {group.category}
              </span>
              <motion.span
                animate={{
                  rotate: expandedCategories.has(group.category) ? 0 : -90,
                }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </motion.span>
            </button>

            {/* Category Items */}
            <AnimatePresence initial={false}>
              {expandedCategories.has(group.category) && (
                <motion.div
                  variants={categoryVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="overflow-hidden"
                >
                  <div className="ml-3 border-l-2 border-primary-pale space-y-0.5 py-1">
                    {group.items.map((item) => {
                      const isActive = item.slug === activeSlug;
                      return (
                        <button
                          key={item.slug}
                          onClick={() => handleSelect(item.slug)}
                          className={clsx(
                            "w-full flex items-center gap-2.5 px-4 py-2 rounded-r-xl text-sm transition-all duration-200 text-left",
                            isActive
                              ? "bg-gradient-to-r from-primary-pale to-accent-pale text-primary font-semibold border-l-2 border-primary -ml-px shadow-sm"
                              : "text-muted hover:text-foreground hover:bg-surface-hover"
                          )}
                        >
                          <FileText
                            className={clsx(
                              "w-3.5 h-3.5 flex-shrink-0",
                              isActive ? "text-primary" : "text-muted"
                            )}
                          />
                          <span className="truncate">{item.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="text-[10px] text-muted text-center font-medium">
          🌸 {groups.reduce((a, g) => a + g.items.length, 0)} topics loaded
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-surface border border-border text-foreground hover:bg-surface-hover transition-colors shadow-md"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="lg:hidden fixed inset-0 z-30 bg-foreground/20 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={clsx(
          "fixed lg:relative z-40 w-[280px] h-full bg-sidebar/90 backdrop-blur-xl border-r border-border flex-shrink-0 shadow-xl shadow-primary/[0.03]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {sidebarContent}
      </motion.aside>
    </>
  );
}
