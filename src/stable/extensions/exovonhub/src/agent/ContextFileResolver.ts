import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const MAX_ATTACHED_FILES = 5;
const MAX_ATTACHED_FILE_CHARS = 6000;

/** Read user-dropped or attached files (supports absolute paths, file:// URIs, relative paths, or bare names). */
export async function resolveContextFilesContent(workspaceRoot: string, contextFiles?: string[]): Promise<string> {
  if (!Array.isArray(contextFiles) || contextFiles.length === 0) {
    return '';
  }

  const parts: string[] = [];
  const seenResolved = new Set<string>();

  for (const rawEntry of contextFiles.slice(0, MAX_ATTACHED_FILES)) {
    let target = String(rawEntry || '').trim();
    if (!target) {
      continue;
    }
    if (target.startsWith('file://')) {
      try {
        target = decodeURIComponent(target.replace(/^file:\/\//, ''));
      } catch {
        target = target.replace(/^file:\/\//, '');
      }
      if (/^\/[a-zA-Z]:[/\\]/.test(target)) {
        target = target.slice(1);
      }
    }

    let resolvedPath: string | null = null;
    const directCandidates = path.isAbsolute(target)
      ? [target]
      : (workspaceRoot ? [path.resolve(workspaceRoot, target)] : []);

    for (const candidate of directCandidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          resolvedPath = candidate;
          break;
        }
      } catch {
        // Ignore inaccessible candidates
      }
    }

    if (!resolvedPath) {
      try {
        const searchPattern = target.includes('/') || target.includes('\\')
          ? `**/${target.replace(/\\/g, '/').replace(/^\/+/, '')}`
          : `**/${target}`;
        const matches = await vscode.workspace.findFiles(searchPattern, '**/node_modules/**', 1);
        if (matches.length > 0) {
          resolvedPath = matches[0].fsPath;
        }
      } catch {
        // Fallback failed
      }
    }

    if (!resolvedPath || seenResolved.has(resolvedPath)) {
      continue;
    }
    seenResolved.add(resolvedPath);

    try {
      const content = await fs.promises.readFile(resolvedPath, 'utf8');
      const truncated = content.length > MAX_ATTACHED_FILE_CHARS
        ? `${content.slice(0, MAX_ATTACHED_FILE_CHARS)}\n[TRUNCATED...]`
        : content;
      const displayLabel = workspaceRoot && resolvedPath.startsWith(workspaceRoot)
        ? path.relative(workspaceRoot, resolvedPath).replace(/\\/g, '/')
        : resolvedPath;
      parts.push(`[Context File: ${displayLabel}]\n\`\`\`\n${truncated}\n\`\`\``);
    } catch {
      // Skip unreadable binary/locked files
    }
  }

  if (parts.length === 0) {
    return '';
  }
  return `\n[USER-SELECTED CONTEXT FILES]\n${parts.join('\n\n')}\n[/USER-SELECTED CONTEXT FILES]\n`;
}
