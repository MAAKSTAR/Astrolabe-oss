export interface TrustedBadgeProps {
  className?: string;
  title?: string;
}

/**
 * Curated list of verified foundation AI research labs and top open-source quantizers.
 */
export const TRUSTED_PUBLISHERS: Set<string> = new Set([
  // Foundation Labs
  'google',
  'meta',
  'meta-llama',
  'nvidia',
  'deepseek-ai',
  'deepseek',
  'qwen',
  'alibaba',
  'mistralai',
  'mistral',
  'microsoft',
  'cohere',
  'cohereforai',
  'tiiuae',
  'stabilityai',
  'black-forest-labs',
  'openai',
  'anthropic',
  'allenai',
  'apple',

  // Reputable Quantizers & Publishers
  'unsloth',
  'lmstudio-community',
  'thebloke',
  'bartowski',
  'quantfactory',
  'nousresearch',
  'cognitivecomputations',
  'city96',
  'comfy-org',
  'maziyarpanahi',
  'mradermacher',
  'huggingface',
]);

/**
 * Checks whether the given author or model repository belongs to a trusted publisher.
 * Case-insensitive matching.
 */
export function isTrustedPublisher(author?: string, modelId?: string): boolean {
  if (author) {
    const cleanAuthor = author.toLowerCase().trim();
    const org = cleanAuthor.includes('/') ? cleanAuthor.split('/')[0] : cleanAuthor;
    if (TRUSTED_PUBLISHERS.has(cleanAuthor) || TRUSTED_PUBLISHERS.has(org)) {
      return true;
    }
  }

  if (modelId) {
    const cleanModel = modelId.toLowerCase().trim();
    const org = cleanModel.includes('/') ? cleanModel.split('/')[0] : cleanModel;
    if (TRUSTED_PUBLISHERS.has(cleanModel) || TRUSTED_PUBLISHERS.has(org)) {
      return true;
    }
  }

  return false;
}

/**
 * Trusted Publisher Badge - Emerald green scalloped starburst rosette with a crisp white checkmark.
 */
export function TrustedBadge({
  className = 'w-3.5 h-3.5 shrink-0',
  title = 'Trusted Publisher',
}: TrustedBadgeProps) {
  const hasTextColor = /\btext-/.test(className);
  const combinedClasses = `${hasTextColor ? '' : 'text-emerald-500'} ${className}`.trim();

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={combinedClasses}
      aria-label={title}
      role="img"
    >
      {title && <title>{title}</title>}
      {/* 12-point scalloped starburst rosette */}
      <path
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.67-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
        fill="currentColor"
      />
      {/* Crisp white checkmark */}
      <path
        d="M7.5 12.25L10.25 15L16.5 8.75"
        stroke="#FFFFFF"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default TrustedBadge;
