import * as path from 'path';
import * as fs from 'fs';

// Import the native Rust N-API module lazily
let parseFileFn: any;

function getParseFile() {
  if (parseFileFn) return parseFileFn;
  try {
    parseFileFn = eval('require')('../../../exovon-core/index.js').parseFile;
  } catch (e) {
    try {
      parseFileFn = eval('require')('/home/maakstar/EXOVON_ECOSYSTEM/exovon-core/index.js').parseFile;
    } catch (e2) {
      parseFileFn = () => ({ symbols: [], edges: [] }); // Safe fallback
    }
  }
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
