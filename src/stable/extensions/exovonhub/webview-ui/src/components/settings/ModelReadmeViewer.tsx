import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw, rehypeHighlight];

const MARKDOWN_COMPONENTS = {
  h1: ({ node, ...props }: any) => (
    <h1 className="text-xl font-bold text-white mt-6 mb-3 pb-2 border-b border-white/10 tracking-tight" {...props} />
  ),
  h2: ({ node, ...props }: any) => (
    <h2 className="text-lg font-bold text-white mt-5 mb-2.5 tracking-tight" {...props} />
  ),
  h3: ({ node, ...props }: any) => (
    <h3 className="text-base font-semibold text-zinc-100 mt-4 mb-2" {...props} />
  ),
  p: ({ node, ...props }: any) => (
    <p className="mb-3.5 text-sm text-zinc-200 leading-relaxed" {...props} />
  ),
  a: ({ node, ...props }: any) => (
    <a className="text-zinc-100 underline underline-offset-2 hover:text-white" target="_blank" rel="noreferrer" {...props} />
  ),
  ul: ({ node, ...props }: any) => (
    <ul className="list-disc pl-5 mb-3.5 space-y-1.5 text-sm text-zinc-200 leading-relaxed" {...props} />
  ),
  ol: ({ node, ...props }: any) => (
    <ol className="list-decimal pl-5 mb-3.5 space-y-1.5 text-sm text-zinc-200 leading-relaxed" {...props} />
  ),
  li: ({ node, ...props }: any) => (
    <li className="text-sm text-zinc-200 leading-relaxed" {...props} />
  ),
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-2 border-white/25 pl-4 my-3 text-sm text-zinc-300 italic leading-relaxed" {...props} />
  ),
  table: ({ node, ...props }: any) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-[13px] text-left text-zinc-200 border-collapse" {...props} />
    </div>
  ),
  th: ({ node, ...props }: any) => (
    <th className="p-2.5 bg-zinc-800/80 font-bold border-b border-white/10 text-white font-mono text-xs" {...props} />
  ),
  td: ({ node, ...props }: any) => (
    <td className="p-2.5 border-b border-white/5 font-mono text-[13px]" {...props} />
  ),
  img: ({ node, src, alt, ...props }: any) => (
    <img
      src={src}
      alt={alt || 'Model illustration'}
      className="max-w-full h-auto rounded-xl my-3 border border-white/10 shadow-lg object-contain block"
      loading="lazy"
      onError={(e) => {
        (e.target as HTMLElement).style.display = 'none';
      }}
      {...props}
    />
  ),
  details: ({ node, ...props }: any) => (
    <details className="my-3 p-3 bg-zinc-950/60 rounded-xl border border-white/10 text-sm text-zinc-200" {...props} />
  ),
  summary: ({ node, ...props }: any) => (
    <summary className="cursor-pointer font-semibold text-zinc-100 hover:text-white select-none py-1" {...props} />
  ),
  code: ({ node, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <div className="my-3 rounded-xl overflow-hidden bg-zinc-950 border border-white/10">
        <pre className="p-3.5 text-[13px] font-mono text-zinc-200 overflow-x-auto custom-scrollbar leading-relaxed">
          <code className={className} {...props}>{children}</code>
        </pre>
      </div>
    ) : (
      <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-100 font-mono text-[13px] border border-white/10" {...props}>
        {children}
      </code>
    );
  }
};

/** Renders Hugging Face repository README markdown with readable typography and CDN-resolved relative images. */
export const ModelReadmeViewer = memo(function ModelReadmeViewer({ content, modelId }: { content: string; modelId?: string }) {
  const sanitized = useMemo(() => {
    let text = (content || '').replace(/^---[\s\S]*?---\s*/, '');
    if (modelId) {
      text = text.replace(/<img\b([^>]*?)src=["'](?:\.\/)?([^"':]+)["']([^>]*?)>/gi, (match, prefix, src, suffix) => {
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return match;
        const resolved = `https://huggingface.co/${modelId}/resolve/main/${src.replace(/^\/+/, '')}`;
        return `<img ${prefix}src="${resolved}"${suffix}>`;
      });
      text = text.replace(/!\[([^\]]*)\]\((?:\.\/)?([^):]+)\)/gi, (match, alt, src) => {
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return match;
        const resolved = `https://huggingface.co/${modelId}/resolve/main/${src.replace(/^\/+/, '')}`;
        return `![${alt}](${resolved})`;
      });
    }
    return text;
  }, [content, modelId]);

  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {sanitized}
    </ReactMarkdown>
  );
});
