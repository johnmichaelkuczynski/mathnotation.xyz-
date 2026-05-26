import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface MarkdownRendererProps {
  content: string;
}

function normalize(src: string): string {
  let s = src.replace(/\r\n/g, "\n");

  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner: string) => {
    const collapsed = inner.replace(/\s+/g, " ").trim();
    return `\n\n$$\n${collapsed}\n$$\n\n`;
  });

  s = s.replace(/\n{3,}/g, "\n\n");
  return s;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const normalized = normalize(content ?? "");
  return (
    <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-serif prose-p:leading-relaxed prose-a:text-primary prose-pre:bg-slate-50 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: "html" }]]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
