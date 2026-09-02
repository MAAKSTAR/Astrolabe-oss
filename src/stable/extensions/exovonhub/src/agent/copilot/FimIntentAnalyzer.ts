export interface FimCorrection {
  original: string;
  replacement: string;
  replacePrefixChars: number; // how many characters before cursor to replace
}

export interface FimIntent {
  type: 'directive_boilerplate' | 'spelling_correction' | 'structural_skeleton' | 'standard_fim';
  directiveTag?: string;
  instruction?: string;
  maxTokens: number;
  temperature: number;
  promptText: string;
  immediateSuggestion?: string;
  correction?: FimCorrection;
}

export class FimIntentAnalyzer {
  // Directive comments: // gen: ..., # scaffold: ..., /* boilerplate: ... */
  private static DIRECTIVE_REGEX = /(?:\/\/|#|\/\*)\s*(gen|generate|scaffold|boilerplate|component|hook|type|schema|impl|implement|todo|fix|spell|correct):\s*(.+?)(?:\*\/|$)/i;

  // Common JS/TS/Web and Game development vocabulary for fuzzy typo resolution
  private static COMMON_VOCABULARY = [
    // Common Enum / Constant States
    'NORMAL', 'DEFAULT', 'MENU', 'PLAYING', 'PAUSED', 'GAMEOVER', 'RESTART', 'VICTORY', 'DEFEAT',
    'ACTIVE', 'INACTIVE', 'PENDING', 'SUCCESS', 'ERROR', 'WARNING', 'INFO', 'DISABLED', 'ENABLED',
    'PRIMARY', 'SECONDARY', 'DANGER', 'SUCCESS', 'LIGHT', 'DARK', 'GHOST',
    // DOM & Canvas APIs
    'document', 'window', 'canvas', 'context', 'getContext', 'getElementById', 'querySelector',
    'querySelectorAll', 'addEventListener', 'removeEventListener', 'requestAnimationFrame',
    'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'textContent', 'innerHTML',
    'classList', 'style', 'width', 'height', 'top', 'left', 'bottom', 'right', 'position',
    'clientX', 'clientY', 'offsetX', 'offsetY', 'pageX', 'pageY',
    // Math & Arrays
    'Math', 'floor', 'ceil', 'round', 'random', 'min', 'max', 'abs', 'sqrt', 'sin', 'cos',
    'length', 'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'filter', 'map', 'forEach',
    'reduce', 'includes', 'indexOf', 'find', 'findIndex', 'concat', 'join', 'split', 'trim',
    // Keywords & Types
    'function', 'return', 'async', 'await', 'import', 'export', 'interface', 'boolean', 'string',
    'number', 'undefined', 'null', 'Promise', 'Array', 'Object', 'JSON', 'clearInterval', 'setInterval',
    'setTimeout', 'clearTimeout'
  ];

  /**
   * Calculate Levenshtein edit distance between two strings
   */
  public static levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Extract all declared identifier and constant tokens from the document context
   */
  public static extractContextVocabulary(fullText: string): string[] {
    const set = new Set<string>(this.COMMON_VOCABULARY);
    // Find all ALL_CAPS constants, CamelCase and camelCase identifiers, and string literal words
    const matches = fullText.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
    for (const m of matches) {
      if (m.length >= 3 && m.length <= 30) {
        set.add(m);
      }
    }
    // Extract single/double quoted enum strings (e.g. 'NORMAL', 'PLAYING')
    const stringMatches = fullText.match(/['"`]([A-Za-z0-9_-]+)['"`]/g) || [];
    for (const sm of stringMatches) {
      const clean = sm.slice(1, -1).trim();
      if (clean.length >= 3) {
        set.add(clean);
      }
    }
    return Array.from(set);
  }

  /**
   * Analyze the cursor prefix and suffix context to detect special intent triggers.
   */
  public static analyze(prefix: string, suffix: string, languageId = 'typescript'): FimIntent {
    const lines = prefix.split('\n');
    const currentLine = lines[lines.length - 1] || '';
    const lastNonEmptyLine = [...lines].reverse().find(l => l.trim().length > 0) || '';

    // 1. Check for Special Directive Comments (e.g. // gen: ..., // scaffold: ..., // fix: ...)
    const directiveMatch = lastNonEmptyLine.match(this.DIRECTIVE_REGEX);
    if (directiveMatch) {
      const tag = directiveMatch[1].toLowerCase();
      const instruction = directiveMatch[2].trim();

      if (tag === 'fix' || tag === 'spell' || tag === 'correct') {
        return {
          type: 'spelling_correction',
          directiveTag: tag,
          instruction,
          maxTokens: 128,
          temperature: 0.1,
          promptText: `<fim_prefix>// Fix spelling & syntax: ${instruction}\n${prefix}<fim_suffix>${suffix}<fim_middle>`
        };
      }

      // Boilerplate / Component / Scaffold Directives
      return {
        type: 'directive_boilerplate',
        directiveTag: tag,
        instruction,
        maxTokens: 384,
        temperature: 0.2,
        promptText: `<fim_prefix>// Scaffold ${languageId}: ${instruction}\n${prefix}<fim_suffix>${suffix}<fim_middle>`
      };
    }

    // 2. Fuzzy Typo & Spelling Detection at Cursor Token
    // Look at the token right at the cursor (e.g. 'NORMel', 'fucntion', 'documnet')
    const tokenMatch = currentLine.match(/(?:['"`]?)([A-Za-z_][A-Za-z0-9_]*)(?:['"`]?)\s*$/);
    if (tokenMatch) {
      const candidate = tokenMatch[1];
      if (candidate.length >= 4) {
        const vocab = this.extractContextVocabulary(prefix + suffix);
        let bestMatch = '';
        let minDistance = 999;

        for (const word of vocab) {
          if (word.toLowerCase() === candidate.toLowerCase() && word !== candidate) {
            // Case mismatch (e.g. 'NORMel' vs 'NORMAL')
            bestMatch = word;
            minDistance = 1;
            break;
          }
          const dist = this.levenshtein(candidate.toLowerCase(), word.toLowerCase());
          const maxAllowedDist = candidate.length <= 5 ? 1 : 2;
          if (dist > 0 && dist <= maxAllowedDist && dist < minDistance) {
            minDistance = dist;
            bestMatch = word;
          }
        }

        if (bestMatch && minDistance <= 2) {
          // Found a high-confidence typo correction!
          return {
            type: 'spelling_correction',
            instruction: `Correct '${candidate}' to '${bestMatch}'`,
            maxTokens: 32,
            temperature: 0.05,
            promptText: `<fim_prefix>${prefix.slice(0, -candidate.length)}${bestMatch}<fim_suffix>${suffix}<fim_middle>`,
            immediateSuggestion: bestMatch,
            correction: {
              original: candidate,
              replacement: bestMatch,
              replacePrefixChars: candidate.length
            }
          };
        }
      }
    }

    // Build FIM prompt string with appropriate tags
    const fimPrompt = suffix.trim().length > 0
      ? `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`
      : `<fim_prefix>${prefix}<fim_middle>`;

    // 3. Structural Skeleton Triggers (Component declaration, Interface declaration, Test suites)
    if (
      /^(?:export\s+default\s+|export\s+)?(?:const|function|class)\s+([A-Z][a-zA-Z0-9]+)\s*(?:=|:\s*React\.FC|\()/.test(currentLine.trim()) ||
      /^(?:export\s+)?(?:interface|type)\s+([A-Z][a-zA-Z0-9]+)/.test(currentLine.trim()) ||
      /^(?:describe|test|it)\s*\(\s*['"]/.test(currentLine.trim())
    ) {
      return {
        type: 'structural_skeleton',
        maxTokens: 256,
        temperature: 0.15,
        promptText: fimPrompt
      };
    }

    // 4. Native Standard FIM (Fill-In-the-Middle) with exact token tags
    return {
      type: 'standard_fim',
      maxTokens: 48,
      temperature: 0.1,
      promptText: fimPrompt
    };
  }
}
