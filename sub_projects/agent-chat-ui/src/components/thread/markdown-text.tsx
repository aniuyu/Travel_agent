"use client";

import "./markdown-styles.css";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { FC, memo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { SyntaxHighlighter } from "@/components/thread/syntax-highlighter";

import { TooltipIconButton } from "@/components/thread/tooltip-icon-button";
import { TravelMap, type TravelMapData } from "@/components/thread/TravelMap";
import { ErrorBoundary } from "@/components/thread/ErrorBoundary";
import { cn } from "@/lib/utils";

import "katex/dist/katex.min.css";

interface CodeHeaderProps {
  language?: string;
  code: string;
}

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-t-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
      <span className="lowercase [&>span]:text-xs">{language}</span>
      <TooltipIconButton
        tooltip="Copy"
        onClick={onCopy}
      >
        {!isCopied && <CopyIcon />}
        {isCopied && <CheckIcon />}
      </TooltipIconButton>
    </div>
  );
};

const defaultComponents: any = {
  h1: ({ className, ...props }: { className?: string }) => (
    <h1
      className={cn(
        "mb-8 scroll-m-20 text-4xl font-extrabold tracking-tight last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: { className?: string }) => (
    <h2
      className={cn(
        "mt-8 mb-4 scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: { className?: string }) => (
    <h3
      className={cn(
        "mt-6 mb-4 scroll-m-20 text-2xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: { className?: string }) => (
    <h4
      className={cn(
        "mt-6 mb-4 scroll-m-20 text-xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }: { className?: string }) => (
    <h5
      className={cn(
        "my-4 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }: { className?: string }) => (
    <h6
      className={cn("my-4 font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }: { className?: string }) => (
    <p
      className={cn("mt-5 mb-5 leading-7 first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }: { className?: string }) => (
    <a
      className={cn(
        "text-primary font-medium underline underline-offset-4",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  // 显式渲染图片：让酒店/行程里的 Markdown 图片能正常显示，
  // 并处理加载失败时的降级提示。
  img: ({ src, alt, className, ...props }: { src?: string; alt?: string; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || "图片"}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn(
        "my-3 max-h-64 w-auto max-w-full rounded-lg border border-border object-cover",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }: { className?: string }) => (
    <blockquote
      className={cn("border-l-2 pl-6 italic", className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }: { className?: string }) => (
    <ul
      className={cn("my-5 ml-6 list-disc [&>li]:mt-2", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }: { className?: string }) => (
    <ol
      className={cn("my-5 ml-6 list-decimal [&>li]:mt-2", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }: { className?: string }) => (
    <hr
      className={cn("my-5 border-b", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }: { className?: string }) => (
    <table
      className={cn(
        "my-5 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }: { className?: string }) => (
    <th
      className={cn(
        "bg-muted px-4 py-2 text-left font-bold first:rounded-tl-lg last:rounded-tr-lg [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: { className?: string }) => (
    <td
      className={cn(
        "border-b border-l px-4 py-2 text-left last:border-r [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }: { className?: string }) => (
    <tr
      className={cn(
        "m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...props}
    />
  ),
  sup: ({ className, ...props }: { className?: string }) => (
    <sup
      className={cn("[&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }: { className?: string }) => (
    <pre
      className={cn(
        "max-w-4xl overflow-x-auto rounded-lg bg-black text-white",
        className,
      )}
      {...props}
    />
  ),
  code: ({
    className,
    children,
    ...props
  }: {
    className?: string;
    children: React.ReactNode;
  }) => {
    const match = /language-(\w+)/.exec(className || "");

    if (match) {
      const language = match[1];
      const code = String(children).replace(/\n$/, "");

      // 地图数据：识别 ```map-json 代码块，渲染成高德地图组件
      if (language === "map-json") {
        try {
          const mapData = JSON.parse(code) as TravelMapData;
          if (mapData && mapData.type === "map") {
            return <TravelMap data={mapData} />;
          }
        } catch {
          // 解析失败则回退到普通代码块展示
        }
      }

      return (
        <>
          <CodeHeader
            language={language}
            code={code}
          />
          <SyntaxHighlighter
            language={language}
            className={className}
          >
            {code}
          </SyntaxHighlighter>
        </>
      );
    }

    return (
      <code
        className={cn("rounded font-semibold", className)}
        {...props}
      >
        {children}
      </code>
    );
  },
};

const MarkdownTextImpl: FC<{ children: string }> = ({ children }) => {
  // 提取 AI 输出中的地图数据（兼容两种格式）：
  // 1. ```map-json ... ``` 代码块
  // 2. 裸 JSON {"type":"map",...}（AI 有时会改写工具返回，把代码块拆成裸 JSON）
  const mapBlocks = extractMapData(children);

  // 把地图数据（JSON / 代码块）从文本中剔除，剩下的文字正常渲染
  let text = children;
  if (mapBlocks.length > 0) {
    // 剔除 ```map-json 代码块
    text = text.replace(/```map-json\s*\{[\s\S]*?\}\s*```/g, "");
    // 剔除裸 JSON（{"type":"map", ...}）
    text = text.replace(/\{\s*"type"\s*:\s*"map"[\s\S]*?\}/g, "");
  }

  return (
    <div className="markdown-content">
      {/* 先渲染地图（在文字上方），用 ErrorBoundary 隔离，避免地图异常拖垮整个消息 */}
      {mapBlocks.map((mapData, i) => (
        <ErrorBoundary key={`map-${i}`}>
          <TravelMap data={mapData} />
        </ErrorBoundary>
      ))}

      {/* 剩余文字正常走 Markdown 渲染 */}
      {text.trim().length > 0 && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={defaultComponents}
        >
          {text}
        </ReactMarkdown>
      )}
    </div>
  );
};

/**
 * 从文本中提取所有地图数据块（TravelMapData）。
 * 兼容：```map-json 代码块、裸 JSON {"type":"map",...}。
 */
function extractMapData(text: string): TravelMapData[] {
  const results: TravelMapData[] = [];

  // 1) 匹配 ```map-json 代码块
  const codeBlockRe = /```map-json\s*(\{[\s\S]*?\})\s*```/g;
  let m: RegExpExecArray | null;
  while ((m = codeBlockRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as TravelMapData;
      if (parsed?.type === "map") results.push(parsed);
    } catch {
      // 忽略解析失败
    }
  }

  // 2) 匹配裸 JSON {"type":"map", ...}（AI 改写后的情况）
  const bareRe = /\{\s*"type"\s*:\s*"map"[\s\S]*?\}/g;
  while ((m = bareRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[0]) as TravelMapData;
      if (parsed?.type === "map") {
        // 去重（避免同一个 JSON 被 codeBlock 和 bare 各匹配一次）
        const dup = results.some(
          (r) => JSON.stringify(r) === JSON.stringify(parsed),
        );
        if (!dup) results.push(parsed);
      }
    } catch {
      // 忽略解析失败
    }
  }

  return results;
}

export const MarkdownText = memo(MarkdownTextImpl);
