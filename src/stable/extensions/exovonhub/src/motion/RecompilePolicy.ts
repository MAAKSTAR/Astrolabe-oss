/**
 * RecompilePolicy.ts — Non-destructive Re-compilation Safety Verification
 *
 * Implements Component F of the Astrolabe Motion Studio Blueprint.
 * Ensures hand-edited GSAP code is never silently overwritten without an explicit confirmation diff.
 */

export interface DiffResult {
  isIdentical: boolean;
  hasManualEdits: boolean;
  existingContent?: string;
  generatedContent: string;
}

/**
 * Compares existing code block against new generated code.
 * Rejects silent auto-overwrite if hand edits are detected.
 */
export function verifyRecompileSafety(existingBlockText: string | undefined, newGeneratedBlockText: string): DiffResult {
  if (!existingBlockText) {
    return {
      isIdentical: false,
      hasManualEdits: false,
      generatedContent: newGeneratedBlockText
    };
  }

  const normalizedExisting = normalizeCode(existingBlockText);
  const normalizedNew = normalizeCode(newGeneratedBlockText);

  const isIdentical = normalizedExisting === normalizedNew;

  return {
    isIdentical,
    hasManualEdits: !isIdentical,
    existingContent: existingBlockText,
    generatedContent: newGeneratedBlockText
  };
}

/**
 * Normalizes code whitespace and comments for structural comparison
 */
function normalizeCode(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // remove comments
    .replace(/\s+/g, ' ')                   // normalize spaces
    .trim();
}
