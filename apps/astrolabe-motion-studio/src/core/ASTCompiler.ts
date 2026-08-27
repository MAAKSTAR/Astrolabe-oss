import {
  Project,
  SyntaxKind,
  SourceFile,
  JsxOpeningElement,
  JsxSelfClosingElement,
  ObjectLiteralExpression,
  PropertyAssignment
} from 'ts-morph';

/**
 * Identifier used to target a specific JSX element in the source AST.
 */
export interface ElementIdentifier {
  tagName?: string;
  className?: string | string[];
  id?: string;
  selector?: string; // e.g. "div.card.active", "#hero", "button.btn-primary", "h1"
  line?: number | string;
  column?: number | string;
  text?: string;
  index?: number; // 0-based index if multiple elements match
  astrolabeId?: string;
}

export type ElementIdentifierInput = string | ElementIdentifier;

/**
 * Style dictionary with CSS or camelCase style properties and values.
 */
export type StyleUpdates = Record<string, string | number | boolean | null | undefined>;

/**
 * Options for compiling AST CSS edits.
 */
export interface CompileOptions {
  createBackup?: boolean;
  formatCode?: boolean;
  overwrite?: boolean;
  filePath?: string;
}

/**
 * Information on the matched JSX element in the source AST.
 */
export interface MatchedElementInfo {
  tagName: string;
  className?: string;
  id?: string;
  line: number;
  column: number;
  text?: string;
}

/**
 * Result returned by the AST compilation process.
 */
export interface CompileResult {
  success: boolean;
  filePath?: string;
  updatedCode?: string;
  originalCode?: string;
  matchedElement?: MatchedElementInfo;
  propertiesUpdated?: string[];
  error?: string;
}

/**
 * Converts CSS kebab-case properties (e.g. 'background-color') to React camelCase ('backgroundColor').
 * Preserves CSS custom variables (e.g. '--accent-color').
 */
export function toCamelCase(str: string): string {
  if (str.startsWith('--')) return str;
  return str.replace(/-([a-z0-9])/gi, (_, char) => char.toUpperCase());
}

/**
 * Converts camelCase to kebab-case (e.g. 'backgroundColor' -> 'background-color').
 */
export function toKebabCase(str: string): string {
  if (str.startsWith('--')) return str;
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/**
 * Formats a JS/JSX style value for AST injection.
 */
export function formatStyleValue(val: string | number | boolean): string {
  if (typeof val === 'number') {
    return String(val);
  }
  if (typeof val === 'boolean') {
    return String(val);
  }
  if (typeof val === 'string') {
    return JSON.stringify(val);
  }
  return JSON.stringify(val);
}

/**
 * Parses a CSS-like selector string or path into an ElementIdentifier object.
 * Examples:
 *   "div.card.active" -> { tagName: "div", className: ["card", "active"] }
 *   "div#hero.card"   -> { tagName: "div", id: "hero", className: ["card"] }
 *   "#header"         -> { id: "header" }
 *   ".btn-primary"    -> { className: ["btn-primary"] }
 *   "button.btn[1]"   -> { tagName: "button", className: ["btn"], index: 1 }
 *   "Card.tsx:25:4"   -> { line: 25, column: 4 }
 *   "motion.div.box"  -> { tagName: "motion.div", className: ["box"] }
 */
export function parseSelector(selector: string): ElementIdentifier {
  const trimmed = selector.trim();
  if (!trimmed) return {};

  let remaining = trimmed;
  let line: number | undefined;
  let column: number | undefined;

  // Extract trailing line and column: :line:col or :line
  const lineColMatch = remaining.match(/:(\d+)(?::(\d+))?$/);
  if (lineColMatch) {
    line = parseInt(lineColMatch[1], 10);
    if (lineColMatch[2]) column = parseInt(lineColMatch[2], 10);
    remaining = remaining.slice(0, lineColMatch.index).trim();
  }

  // Extract index: [n] or :nth(n) or :nth-child(n)
  let index: number | undefined;
  const indexMatch = remaining.match(/\[(\d+)\]$/) || remaining.match(/:nth(?:-child)?\((\d+)\)$/i);
  if (indexMatch) {
    index = parseInt(indexMatch[1], 10);
    remaining = remaining.slice(0, indexMatch.index).trim();
  }

  // If remaining is a file path (e.g. Card.tsx, components/Hero.jsx), return line/column only
  if (
    remaining.endsWith('.tsx') ||
    remaining.endsWith('.jsx') ||
    remaining.endsWith('.ts') ||
    remaining.endsWith('.js') ||
    remaining.includes('/') ||
    remaining.includes('\\')
  ) {
    return { line, column, index };
  }

  let tagName: string | undefined;
  let id: string | undefined;
  const classNames: string[] = [];

  // Extract ID if present
  const idIdx = remaining.indexOf('#');
  let afterId = '';
  if (idIdx !== -1) {
    const beforeId = remaining.slice(0, idIdx);
    const idPart = remaining.slice(idIdx + 1);
    const firstDot = idPart.indexOf('.');
    if (firstDot !== -1) {
      id = idPart.slice(0, firstDot);
      afterId = idPart.slice(firstDot);
    } else {
      id = idPart;
    }
    remaining = beforeId + afterId;
  }

  // Extract Tag and Classes
  if (remaining.startsWith('.')) {
    remaining.split('.').filter(Boolean).forEach((cls) => classNames.push(cls));
  } else {
    const parts = remaining.split('.');
    if (parts.length > 0) {
      // Support compound tag names like motion.div or UI.Card
      if (
        parts.length > 1 &&
        (parts[0] === 'motion' ||
          (parts[0] &&
            parts[0][0] === parts[0][0].toUpperCase() &&
            parts[1] &&
            parts[1][0] === parts[1][0].toUpperCase()))
      ) {
        tagName = `${parts[0]}.${parts[1]}`;
        parts.slice(2).filter(Boolean).forEach((cls) => classNames.push(cls));
      } else {
        tagName = parts[0] || undefined;
        parts.slice(1).filter(Boolean).forEach((cls) => classNames.push(cls));
      }
    }
  }

  return {
    tagName: tagName || undefined,
    id: id || undefined,
    className: classNames.length > 0 ? classNames : undefined,
    line,
    column,
    index
  };
}

/**
 * Normalizes an ElementIdentifierInput into an ElementIdentifier object.
 */
export function parseIdentifierInput(input: ElementIdentifierInput): ElementIdentifier {
  if (typeof input === 'object' && input !== null) {
    if (input.selector) {
      const parsed = parseSelector(input.selector);
      return {
        ...parsed,
        ...input,
        className: input.className || parsed.className,
        tagName: input.tagName || parsed.tagName,
        id: input.id || parsed.id
      };
    }
    return input;
  }

  if (typeof input === 'string') {
    return parseSelector(input);
  }

  return {};
}

interface ParsedElementMetadata {
  el: JsxOpeningElement | JsxSelfClosingElement;
  info: MatchedElementInfo;
  classNames: string[];
}

/**
 * Extracts metadata from a JSX opening or self-closing element.
 */
function extractElementMetadata(
  el: JsxOpeningElement | JsxSelfClosingElement
): ParsedElementMetadata {
  const tagName = el.getTagNameNode().getText();
  const startLine = el.getStartLineNumber();
  const sourceText = el.getSourceFile().getFullText();
  const lineStartPos = sourceText.lastIndexOf('\n', el.getStart() - 1);
  const startColumn = lineStartPos === -1 ? el.getStart() + 1 : el.getStart() - lineStartPos;

  let id: string | undefined;
  const idAttr = el.getAttribute('id');
  if (idAttr && idAttr.isKind(SyntaxKind.JsxAttribute)) {
    const init = idAttr.getInitializer();
    if (init && init.isKind(SyntaxKind.StringLiteral)) {
      id = init.getLiteralValue();
    } else if (init && init.isKind(SyntaxKind.JsxExpression)) {
      const expr = init.getExpression();
      if (expr && expr.isKind(SyntaxKind.StringLiteral)) {
        id = expr.getLiteralValue();
      }
    }
  }

  const classNames: string[] = [];
  const classAttr = el.getAttribute('className') || el.getAttribute('class');
  if (classAttr && classAttr.isKind(SyntaxKind.JsxAttribute)) {
    const init = classAttr.getInitializer();
    if (init) {
      if (init.isKind(SyntaxKind.StringLiteral)) {
        init.getLiteralValue().split(/\s+/).filter(Boolean).forEach((c) => classNames.push(c));
      } else if (init.isKind(SyntaxKind.JsxExpression)) {
        const expr = init.getExpression();
        if (expr && expr.isKind(SyntaxKind.StringLiteral)) {
          expr.getLiteralValue().split(/\s+/).filter(Boolean).forEach((c) => classNames.push(c));
        } else if (expr) {
          // Template literals or expressions
          expr.getText().split(/\s+/).filter(Boolean).forEach((c) => classNames.push(c.replace(/['"`]/g, '')));
        }
      }
    }
  }

  let text = '';
  if (el.isKind(SyntaxKind.JsxOpeningElement)) {
    const parent = el.getParent();
    if (parent && parent.isKind(SyntaxKind.JsxElement)) {
      text = parent.getJsxChildren().map((c) => c.getText()).join(' ').trim();
    }
  }

  return {
    el,
    info: {
      tagName,
      className: classNames.join(' ') || undefined,
      id,
      line: startLine,
      column: startColumn,
      text: text || undefined
    },
    classNames
  };
}

/**
 * Searches the AST for the JSX element matching the given identifier.
 * Uses a heuristic scoring mechanism that prioritizes exact line matches, ID matches,
 * tag name matches, and CSS class matches.
 */
export function findJSXElement(
  sourceFile: SourceFile,
  identifierInput: ElementIdentifierInput
): { element: JsxOpeningElement | JsxSelfClosingElement; info: MatchedElementInfo; score: number } | null {
  const target = parseIdentifierInput(identifierInput);
  const openingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
  const selfClosingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
  const allElements = [...openingElements, ...selfClosingElements].map(extractElementMetadata);

  if (allElements.length === 0) return null;

  const targetClasses: string[] = Array.isArray(target.className)
    ? target.className
    : typeof target.className === 'string'
      ? target.className.split(/\s+/).filter(Boolean)
      : [];

  const scored = allElements.map((item) => {
    let score = 0;

    // Line match (highest weight)
    if (target.line !== undefined) {
      const lineNum = typeof target.line === 'string' ? parseInt(target.line, 10) : target.line;
      if (item.info.line === lineNum) {
        score += 1000;
      } else {
        score -= 50;
      }
    }

    // ID match
    if (target.id) {
      if (item.info.id === target.id) {
        score += 500;
      } else if (item.info.id) {
        score -= 200;
      }
    }

    // Tag name match
    if (target.tagName && target.tagName !== '*') {
      if (item.info.tagName.toLowerCase() === target.tagName.toLowerCase()) {
        score += 100;
        if (item.info.tagName === target.tagName) {
          score += 50;
        }
      } else {
        score -= 200;
      }
    }

    // Class names match
    if (targetClasses.length > 0) {
      let matchedCount = 0;
      for (const cls of targetClasses) {
        if (item.classNames.includes(cls)) {
          matchedCount++;
          score += 60;
        }
      }
      if (matchedCount === targetClasses.length) {
        score += 120;
      } else if (matchedCount === 0) {
        score -= 60;
      }
    }

    // Text content match
    if (target.text && item.info.text) {
      if (item.info.text.includes(target.text)) {
        score += 40;
      }
    }

    return { ...item, score };
  });

  const matching = scored.filter((s) => s.score > 0);
  matching.sort((a, b) => b.score - a.score);

  if (matching.length === 0) {
    // If no specific selector was provided (e.g. empty target), pick first element
    if (!target.tagName && !target.id && targetClasses.length === 0 && target.line === undefined) {
      return { element: scored[0].el, info: scored[0].info, score: scored[0].score };
    }
    return null;
  }

  const selectedIndex = target.index !== undefined ? target.index : 0;
  const match = matching[selectedIndex] || matching[0];
  return { element: match.el, info: match.info, score: match.score };
}

/**
 * Merges style properties into a JSX element's `style={{}}` attribute.
 * Preserves existing inline style properties, spread expressions, and code structure.
 */
export function mergeStylesIntoJSXElement(
  element: JsxOpeningElement | JsxSelfClosingElement,
  styles: StyleUpdates
): { modified: boolean; propertiesUpdated: string[] } {
  const normalizedStyles: Record<string, any> = {};
  const propertiesUpdated: string[] = [];

  for (const [rawKey, rawVal] of Object.entries(styles)) {
    const key = toCamelCase(rawKey);
    normalizedStyles[key] = rawVal;
    propertiesUpdated.push(key);
  }

  const styleAttr = element.getAttribute('style');

  if (styleAttr && styleAttr.isKind(SyntaxKind.JsxAttribute)) {
    const init = styleAttr.getInitializer();

    if (init && init.isKind(SyntaxKind.JsxExpression)) {
      const expr = init.getExpression();

      // Case 1: style={{ ... }} is an ObjectLiteralExpression
      if (expr && expr.isKind(SyntaxKind.ObjectLiteralExpression)) {
        for (const [key, val] of Object.entries(normalizedStyles)) {
          const propName = key.startsWith('--') || key.includes('-') ? JSON.stringify(key) : key;
          const existingProp =
            expr.getProperty(key) ||
            (key.startsWith('--') || key.includes('-') ? expr.getProperty(JSON.stringify(key)) : undefined);

          if (val === null || val === undefined || val === '') {
            // Remove style property if set to null / empty
            if (existingProp) {
              existingProp.remove();
            }
          } else {
            const formatted = formatStyleValue(val);
            if (existingProp && existingProp.isKind(SyntaxKind.PropertyAssignment)) {
              existingProp.setInitializer(formatted);
            } else if (!existingProp) {
              expr.addPropertyAssignment({
                name: propName,
                initializer: formatted
              });
            }
          }
        }
        return { modified: true, propertiesUpdated };
      }

      // Case 2: style={customVariable} is a variable or expression -> wrap and merge
      if (expr) {
        const origExprText = expr.getText();
        const assignments = Object.entries(normalizedStyles)
          .filter(([_, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => {
            const propKey = k.startsWith('--') || k.includes('-') ? JSON.stringify(k) : k;
            return `${propKey}: ${formatStyleValue(v)}`;
          });

        const newInit = `{{ ...${origExprText}, ${assignments.join(', ')} }}`;
        styleAttr.setInitializer(newInit);
        return { modified: true, propertiesUpdated };
      }
    }
  }

  // Case 3: No existing style attribute -> create new style={{ ... }}
  const validEntries = Object.entries(normalizedStyles).filter(
    ([_, v]) => v !== null && v !== undefined && v !== ''
  );

  if (validEntries.length === 0) {
    if (styleAttr && styleAttr.isKind(SyntaxKind.JsxAttribute)) {
      styleAttr.remove();
    }
    return { modified: true, propertiesUpdated: [] };
  }

  const propStrings = validEntries.map(([k, v]) => {
    const propKey = k.startsWith('--') || k.includes('-') ? JSON.stringify(k) : k;
    return `${propKey}: ${formatStyleValue(v)}`;
  });

  const styleValueStr = `{{ ${propStrings.join(', ')} }}`;

  if (styleAttr && styleAttr.isKind(SyntaxKind.JsxAttribute)) {
    styleAttr.setInitializer(styleValueStr);
  } else {
    if (styleAttr) {
      styleAttr.remove();
    }
    element.addAttribute({
      name: 'style',
      initializer: styleValueStr
    });
  }

  return { modified: true, propertiesUpdated };
}

/**
 * Compiles CSS edits directly into source code string in memory.
 */
export function compileCSSEditsToCode(
  sourceCode: string,
  elementIdentifier: ElementIdentifierInput,
  styles: StyleUpdates,
  filePath = 'Component.tsx'
): { updatedCode: string; matchedElement?: MatchedElementInfo; propertiesUpdated: string[] } {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, sourceCode, { overwrite: true });

  const found = findJSXElement(sourceFile, elementIdentifier);
  if (!found) {
    throw new Error(
      `Could not find matching JSX element in AST for identifier: ${JSON.stringify(elementIdentifier)}`
    );
  }

  const { propertiesUpdated } = mergeStylesIntoJSXElement(found.element, styles);

  return {
    updatedCode: sourceFile.getFullText(),
    matchedElement: found.info,
    propertiesUpdated
  };
}

/**
 * Internal helper to read source file from disk via Electron IPC or Node fs.
 */
async function readSourceFileViaIPC(filePath: string): Promise<string> {
  if (typeof window !== 'undefined') {
    const api = (window as any).electronAPI;
    if (api) {
      const readFn = api.readFile || api.fsReadFile;
      if (typeof readFn === 'function') {
        const res = await readFn(filePath);
        if (res && res.success && typeof res.data === 'string') {
          return res.data;
        }
        throw new Error(res?.error || `Failed to read file via IPC: ${filePath}`);
      }
    }
  }

  // Node.js runtime fallback (for tests, CLI, or main process)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Failed to read file from filesystem: ${err.message}`);
    }
  }

  throw new Error(`IPC readFile is not available in current environment for file: ${filePath}`);
}

/**
 * Internal helper to write source file to disk via Electron IPC or Node fs.
 */
async function writeSourceFileViaIPC(filePath: string, content: string): Promise<void> {
  if (typeof window !== 'undefined') {
    const api = (window as any).electronAPI;
    if (api) {
      const writeFn = api.writeFile || api.fsWriteFile;
      if (typeof writeFn === 'function') {
        const res = await writeFn(filePath, content);
        if (!res || !res.success) {
          throw new Error(res?.error || `Failed to write file via IPC: ${filePath}`);
        }
        return;
      }
    }
  }

  // Node.js runtime fallback (for tests, CLI, or main process)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return;
    } catch (err: any) {
      throw new Error(`Failed to write file to filesystem: ${err.message}`);
    }
  }

  throw new Error(`IPC writeFile is not available in current environment for file: ${filePath}`);
}

/**
 * Compiles CSS style edits into a source file on disk.
 *
 * 1. Reads the source file via Electron IPC (fs:readFile).
 * 2. Parses the file into a TypeScript/JSX AST using ts-morph.
 * 3. Locates the targeted JSX element using the provided identifier.
 * 4. Merges the style updates into the element's inline `style={{}}` prop, preserving existing code.
 * 5. Writes the updated source file back to disk via Electron IPC (fs:writeFile).
 *
 * @param filePath The absolute or relative path to the JSX/TSX source file.
 * @param elementIdentifier Identifier specifying the target JSX element (e.g. "div.card", "h1.title", "#hero", or ElementIdentifier object).
 * @param styles Object containing style property-value pairs to merge.
 * @param options Optional compilation settings.
 */
export async function compileCSSEdits(
  filePath: string,
  elementIdentifier: ElementIdentifierInput,
  styles: StyleUpdates,
  options?: CompileOptions
): Promise<CompileResult> {
  try {
    const originalCode = await readSourceFileViaIPC(filePath);

    const { updatedCode, matchedElement, propertiesUpdated } = compileCSSEditsToCode(
      originalCode,
      elementIdentifier,
      styles,
      filePath
    );

    await writeSourceFileViaIPC(filePath, updatedCode);

    return {
      success: true,
      filePath,
      updatedCode,
      originalCode,
      matchedElement,
      propertiesUpdated
    };
  } catch (error: any) {
    return {
      success: false,
      filePath,
      error: error.message || String(error)
    };
  }
}

/**
 * Compiles CSS edits and generates a modified code string without writing to disk,
 * returning the original and modified code for diff review.
 */
export async function previewCSSEdits(
  filePath: string,
  elementIdentifier: ElementIdentifierInput,
  styles: StyleUpdates
): Promise<{ success: boolean; originalCode: string; modifiedCode: string; diffSummary: string[]; filePath: string; error?: string }> {
  try {
    const originalCode = await readSourceFileViaIPC(filePath);

    const { updatedCode, propertiesUpdated } = compileCSSEditsToCode(
      originalCode,
      elementIdentifier,
      styles,
      filePath
    );

    return {
      success: true,
      originalCode,
      modifiedCode: updatedCode,
      diffSummary: propertiesUpdated,
      filePath
    };
  } catch (error: any) {
    return {
      success: false,
      originalCode: '',
      modifiedCode: '',
      diffSummary: [],
      filePath,
      error: error.message || String(error)
    };
  }
}

/**
 * ASTCompiler Class Namespace
 */
export class ASTCompiler {
  static compileCSSEdits = compileCSSEdits;
  static previewCSSEdits = previewCSSEdits;
  static compileCSSEditsToCode = compileCSSEditsToCode;
  static findJSXElement = findJSXElement;
  static mergeStylesIntoJSXElement = mergeStylesIntoJSXElement;
  static parseSelector = parseSelector;
  static parseIdentifierInput = parseIdentifierInput;
  static toCamelCase = toCamelCase;
  static toKebabCase = toKebabCase;
}

export default ASTCompiler;
