/**
 * Allows safe image, media, and webview resource URLs inside react-markdown v10+,
 * which strips `data:` URIs by default unless explicitly permitted.
 */
export function safeMarkdownUrlTransform(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (/^data:(?:image\/(?:png|jpeg|jpg|gif|webp|avif)|video\/(?:mp4|webm|ogg|quicktime));base64,/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(?:https?|mailto|tel|vscode-webview-resource|vscode-resource|blob):/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('#')) {
    return trimmed;
  }
  return '';
}

const SAVED_TO_REGEX = /^\s*\*?Saved to:?\s*`?(\/[^\n`*]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov|mkv|avi))`?\*?\s*$/gim;
const GENERATED_ART_REGEX = /!\[Generated Art\]\(([^)]*)\)/gi;
const GENERATED_BANNER_REGEX = /^\s*✦\s*(?:Image|Video) generated successfully[^\n]*\n*/gim;

export interface ParsedChatMediaInfo {
  cleanedText: string;
  resolvedSavedPath?: string;
  fallbackImageSrc?: string;
}

/**
 * Strips legacy markdown image placeholders and verbose "*Saved to*" lines when rendering
 * dedicated image/video media cards, while recovering file paths or data URIs from history rows.
 */
export function extractLegacyMediaText(
  rawText: string | undefined,
  savedPath: string | undefined,
  hasStructuredMedia: boolean
): ParsedChatMediaInfo {
  const text = rawText || '';
  let resolvedSavedPath = savedPath;
  let fallbackImageSrc: string | undefined;

  if (!resolvedSavedPath) {
    const savedMatch = text.match(/\*?Saved to:?\s*`?(\/[^\n`*]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov|mkv|avi))`?\*?/i);
    if (savedMatch?.[1]) {
      resolvedSavedPath = savedMatch[1].trim();
    }
  }

  const artMatch = text.match(/!\[Generated Art\]\(([^)]+)\)/i);
  if (artMatch?.[1]) {
    const candidate = artMatch[1].trim();
    if (candidate && candidate !== 'undefined' && candidate !== 'null') {
      fallbackImageSrc = candidate;
    }
  }

  let cleanedText = text;
  if (hasStructuredMedia || fallbackImageSrc || resolvedSavedPath) {
    cleanedText = cleanedText
      .replace(GENERATED_ART_REGEX, '')
      .replace(SAVED_TO_REGEX, '')
      .replace(GENERATED_BANNER_REGEX, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return {
    cleanedText,
    resolvedSavedPath,
    fallbackImageSrc
  };
}
