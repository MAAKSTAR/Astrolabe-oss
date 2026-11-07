import * as path from 'path';
import * as fs from 'fs';

// Import the native Rust N-API module lazily
let parseFileFn: any;

function fallbackParseFile(filePath: string, fileContent: string): { symbols: SymbolNode[], edges: Edge[] } {
  const symbols: SymbolNode[] = [];
  const lines = fileContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Functions / Methods: function foo, async function foo, def foo, fn foo
    const fnMatch = line.match(/(?:async\s+)?(?:function\*?|def|fn)\s+([a-zA-Z0-9_$]+)/);
    if (fnMatch) {
      symbols.push({
        id: `${filePath}:${fnMatch[1]}:${lineNum}`,
        filePath,
        name: fnMatch[1],
        kind: 'function',
        lineStart: lineNum,
        lineEnd: lineNum
      });
      continue;
    }

    // Arrow functions / const funcs: const foo = (...) => or const foo = function
    const constFnMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/);
    if (constFnMatch) {
      symbols.push({
        id: `${filePath}:${constFnMatch[1]}:${lineNum}`,
        filePath,
        name: constFnMatch[1],
        kind: 'function',
        lineStart: lineNum,
        lineEnd: lineNum
      });
      continue;
    }

    // Classes / Structs / Interfaces: class Foo, interface Foo, struct Foo
    const classMatch = line.match(/(?:export\s+)?(?:class|interface|struct|enum|type)\s+([a-zA-Z0-9_$]+)/);
    if (classMatch) {
      symbols.push({
        id: `${filePath}:${classMatch[1]}:${lineNum}`,
        filePath,
        name: classMatch[1],
        kind: 'class',
        lineStart: lineNum,
        lineEnd: lineNum
      });
      continue;
    }
  }

  return { symbols, edges: [] };
}

function getParseFile() {
  if (parseFileFn) return parseFileFn;
  
  const homeDir = process.env.HOME || '/home/maakstar';
  const candidatePaths = [
    path.join(__dirname, '..', '..', '..', 'exovon-core', 'index.js'),
    path.join(__dirname, '..', 'exovon-core', 'index.js'),
    path.join(homeDir, 'EXOVON_ECOSYSTEM', 'exovon-core', 'index.js'),
    '/home/maakstar/EXOVON_ECOSYSTEM/exovon-core/index.js'
  ];

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const mod = eval('require')(candidate);
        if (mod && typeof mod.parseFile === 'function') {
          parseFileFn = mod.parseFile;
          return parseFileFn;
        }
      }
    } catch (e) {
      // try next candidate
    }
  }

  parseFileFn = fallbackParseFile;
  return parseFileFn;
}

export interface SymbolNode {
  id: string;
  filePath: string;
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
}

export interface Edge {
  sourceId: string;
  targetId: string;
  relationType: 'calls' | 'imports' | 'references';
}

export class GraphIndexer {
  public static async init() {
    // The native Rust addon (napi-rs) requires no async initialization!
    // Tree-sitter WASM downloading is no longer necessary.
    return Promise.resolve();
  }

  public static async parseFile(filePath: string, fileContent: string): Promise<{ symbols: SymbolNode[], edges: Edge[] }> {
    // We delegate completely to the Rust N-API engine.
    // The transfer is instantaneous due to SharedArrayBuffer / Native V8 bindings.
    try {
      const result = getParseFile()(filePath, fileContent);
      return {
        symbols: result.symbols,
        edges: result.edges,
      };
    } catch (e) {
      console.error(`[GraphIndexer] Rust Addon failed to parse file: ${filePath}`, e);
      return { symbols: [], edges: [] };
    }
  }
}
