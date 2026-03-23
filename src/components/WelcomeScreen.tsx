"use client";

import { motion } from "framer-motion";
import { BookOpen, Sparkles, Code2, Globe } from "lucide-react";

const features = [
  {
    icon: Code2,
    title: "代码高亮",
    description: "支持多语言语法高亮的代码块",
    color: "from-violet-400 to-purple-500",
    bgColor: "bg-violet-50",
  },
  {
    icon: BookOpen,
    title: "结构化笔记",
    description: "Markdown 驱动，自动生成目录",
    color: "from-pink-400 to-rose-500",
    bgColor: "bg-pink-50",
  },
  {
    icon: Globe,
    title: "覆盖全面",
    description: "前端、算法、网络等核心知识",
    color: "from-sky-400 to-blue-500",
    bgColor: "bg-sky-50",
  },
  {
    icon: Sparkles,
    title: "随时扩展",
    description: "添加文件夹和 .md 文件即可扩展",
    color: "from-emerald-400 to-teal-500",
    bgColor: "bg-emerald-50",
  },
];

export default function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-2xl text-center"
      >
        {/* Glow orb */}
        <div className="relative mb-8 inline-block">
          <div className="absolute inset-0 blur-3xl bg-gradient-to-r from-primary/30 to-accent/30 rounded-full scale-150" />
          <div className="relative w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
        </div>

        <h2 className="text-3xl font-extrabold mb-3 tracking-tight">
          <span className="bg-gradient-to-r from-primary via-accent to-sky bg-clip-text text-transparent">
            PM Interview Toolbox
          </span>
        </h2>
        <p className="text-muted text-sm mb-10 max-w-md mx-auto leading-relaxed">
          ✨ 你的技术面试备战知识库。从左侧菜单选择一个主题开始学习吧~
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 * i }}
              className="p-5 rounded-2xl bg-card border border-border hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group text-left"
            >
              <div
                className={clsx(
                  "w-9 h-9 rounded-xl flex items-center justify-center mb-3 bg-gradient-to-br shadow-sm",
                  feature.color
                )}
              >
                <feature.icon className="w-4.5 h-4.5 text-white" />
              </div>
              <h3 className="text-sm font-bold text-foreground mb-1">
                {feature.title}
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-10 text-[11px] text-muted"
        >
          <kbd className="px-2 py-1 rounded-lg bg-primary-pale border border-border text-xs font-semibold text-primary">
            ←
          </kbd>{" "}
          从左侧菜单选择主题开始
        </motion.div>
      </motion.div>
    </div>
  );
}

function clsx(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}
