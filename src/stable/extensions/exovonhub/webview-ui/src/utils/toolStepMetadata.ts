export type ToolIconKind =
  | 'think'
  | 'log'
  | 'compact'
  | 'chatHistory'
  | 'fetchPage'
  | 'webSearch'
  | 'readFile'
  | 'listDir'
  | 'codeEdit'
  | 'createDoc'
  | 'deleteFile'
  | 'codeSearch'
  | 'terminal'
  | 'plan'
  | 'memoryGraph'
  | 'imageGen'
  | 'subAgent'
  | 'cloudDeploy'
  | 'toolbox';

export interface ToolStepMetaInput {
  id?: string;
  type?: 'think' | 'tool' | 'log' | string;
  toolName?: string;
  content?: string;
  title?: string;
  actionVerb?: string;
  targetDisplay?: string;
  lineInfo?: string;
  filePath?: string;
  output?: string;
  iconKind?: ToolIconKind | string;
}

export interface ResolvedToolStepMeta {
  canonicalToolName: string;
  iconKind: ToolIconKind;
  actionVerb: string;
  targetDisplay: string;
  rawTarget: string;
  lineInfo: string;
  filePath: string;
  parsedPayload: Record<string, unknown>;
  isCommand: boolean;
  commandText: string;
}

const TOOL_NAME_MAP: Record<string, string> = {
  // Plan & rules
  submitplan: 'submitPlan',
  submitplane: 'submitPlan',
  editplan: 'submitPlan',
  editplane: 'submitPlan',
  updateplan: 'submitPlan',
  updateplane: 'submitPlan',
  modifyplan: 'submitPlan',
  queryconstitution: 'queryConstitution',
  getconstitution: 'queryConstitution',
  readconstitution: 'queryConstitution',
  updateconstitution: 'updateConstitution',
  addconstitutionrule: 'updateConstitution',
  saveconstitution: 'updateConstitution',
  readcoordination: 'readCoordination',
  updatecoordination: 'updateCoordination',
  // Workspace files & docs
  listdir: 'listDir',
  listdirectory: 'listDir',
  ls: 'listDir',
  viewfile: 'viewFile',
  readfile: 'viewFile',
  applypatch: 'applyPatch',
  multireplacefilecontent: 'multiReplaceFileContent',
  replacefilecontent: 'multiReplaceFileContent',
  writetofile: 'multiReplaceFileContent',
  createfile: 'createFile',
  writefile: 'createFile',
  deletefile: 'deleteFile',
  removefile: 'deleteFile',
  createdoc: 'createDoc',
  writedoc: 'createDoc',
  savedoc: 'createDoc',
  synthesizedoc: 'createDoc',
  renderdoc: 'createDoc',
  // Search, memory & graph
  grepsearch: 'grepSearch',
  semanticsearch: 'semanticSearch',
  queryprojectmemory: 'queryProjectMemory',
  getprojectmemory: 'queryProjectMemory',
  readprojectmemory: 'queryProjectMemory',
  projectmemory: 'queryProjectMemory',
  querymemory: 'queryProjectMemory',
  getmemory: 'queryProjectMemory',
  querygraph: 'queryGraph',
  querysemanticvector: 'querySemanticVector',
  getworkspacehash: 'getWorkspaceHash',
  // Web & browser
  searchweb: 'searchWeb',
  fetchwebpage: 'fetchWebPage',
  fetchurl: 'fetchWebPage',
  readwebpage: 'fetchWebPage',
  readurl: 'fetchWebPage',
  scrapewebpage: 'fetchWebPage',
  openbrowserpreview: 'openBrowserPreview',
  highlightbrowserelement: 'highlightBrowserElement',
  // Terminal
  runcommand: 'runCommand',
  executecommand: 'runCommand',
  sendterminalinput: 'sendTerminalInput',
  checkterminalstatus: 'checkTerminalStatus',
  // Chat, agent, media, cloud, tools
  getchathistory: 'getChatHistory',
  chathistory: 'getChatHistory',
  listusermessages: 'getChatHistory',
  getusermessages: 'getChatHistory',
  spawnsubagent: 'spawnSubAgent',
  generateimage: 'generateImage',
  deploytoexovoncloud: 'deployToExovonCloud',
  deploytocloud: 'deployToExovonCloud',
  listavailabletools: 'listAvailableTools',
  listtools: 'listAvailableTools',
  getavailabletools: 'listAvailableTools',
  help: 'listAvailableTools',
};

const ICON_KEYWORD_RULES: Array<[string[], ToolIconKind]> = [
  [['chat', 'history', 'conversation', 'thread'], 'chatHistory'],
  [['fetch', 'webpage', 'browser', 'highlight', 'scrape', 'url', 'page'], 'fetchPage'],
  [['web'], 'webSearch'],
  [['command', 'terminal', 'shell'], 'terminal'],
  [['delete', 'remove', 'unlink'], 'deleteFile'],
  [['plan', 'constitution', 'coordinat'], 'plan'],
  [['memory', 'graph', 'vector', 'hash'], 'memoryGraph'],
  [['image', 'diffusion'], 'imageGen'],
  [['subagent', 'agent'], 'subAgent'],
  [['deploy', 'cloud'], 'cloudDeploy'],
  [['doc'], 'createDoc'],
  [['dir', 'folder'], 'listDir'],
  [['patch', 'edit', 'replace', 'create', 'write'], 'codeEdit'],
  [['search', 'grep', 'find'], 'codeSearch'],
  [['view', 'read', 'file'], 'readFile'],
];

const VALID_ICON_KINDS = new Set<string>([
  'think', 'log', 'compact', 'chatHistory', 'fetchPage', 'webSearch', 'readFile',
  'listDir', 'codeEdit', 'createDoc', 'deleteFile', 'codeSearch', 'terminal',
  'plan', 'memoryGraph', 'imageGen', 'subAgent', 'cloudDeploy', 'toolbox',
]);

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.substring(0, Math.max(0, maxLen - 3)) + '...';
}

function formatCompactUrl(url: string): string {
  return truncate(url.trim().replace(/^https?:\/\//i, '') || url, 40);
}

function getBaseName(filePath: string): string {
  if (!filePath) return '';
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

export function parseToolPayload(rawContent?: string): Record<string, unknown> {
  if (!rawContent) return {};
  try {
    const parsed = JSON.parse(rawContent);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* fall through */ }
  return { raw: rawContent };
}

export function canonicalizeToolName(rawName?: string): string {
  if (!rawName) return '';
  const compact = rawName.toLowerCase().replace(/[-_]/g, '');
  return TOOL_NAME_MAP[compact] || rawName;
}

function formatFallbackToolVerb(rawName: string): string {
  if (!rawName) return 'Tool';
  return (
    rawName
      .replace(/^mcp_{1,2}/i, '')
      .replace(/__/g, ' · ')
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim() || 'Tool'
  );
}

function inferIconKindFromName(rawName: string): ToolIconKind {
  const tool = rawName.toLowerCase();
  for (const [keywords, kind] of ICON_KEYWORD_RULES) {
    if (keywords.some((kw) => tool.includes(kw))) return kind;
  }
  return 'toolbox';
}

function extractLineInfo(args: Record<string, unknown>, output?: string, preset?: string): string {
  if (preset) return preset;
  if (output) {
    const rangeMatch = output.match(/Showing lines (\d+) to (\d+)/i);
    if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]}`;
    const lineMatch = output.match(/\((\d+)\s*lines total\)/i);
    if (lineMatch) return `1-${lineMatch[1]}`;
  }
  const startLine = args.startLine ?? args.StartLine ?? args.start_line ?? args.fromLine;
  const endLine = args.endLine ?? args.EndLine ?? args.end_line ?? args.toLine;
  if (startLine !== undefined && endLine !== undefined) return `${startLine}-${endLine}`;
  return startLine !== undefined ? `line ${startLine}` : '';
}

function quoteTruncate(val: unknown, maxLen = 35): string {
  const s = String(val ?? '').trim();
  return s ? `"${truncate(s, maxLen)}"` : '';
}

function buildToolOverrides(
  canonical: string,
  args: Record<string, unknown>,
  rawFilePath: string,
  baseFileName: string,
  lineInfo: string,
  cmdText: string
): Partial<ResolvedToolStepMeta> | null {
  switch (canonical) {
    case 'viewFile':
      return { iconKind: 'readFile', actionVerb: 'Read', targetDisplay: baseFileName || rawFilePath || 'file', rawTarget: rawFilePath || baseFileName, lineInfo };
    case 'listDir': {
      const dirTarget = String(args.relativePath || args.DirectoryPath || args.directory || args.dir || args.path || rawFilePath || '.');
      return { iconKind: 'listDir', actionVerb: 'List', targetDisplay: truncate(dirTarget, 40), rawTarget: dirTarget, filePath: dirTarget };
    }
    case 'applyPatch':
    case 'multiReplaceFileContent':
      return { iconKind: 'codeEdit', actionVerb: 'Edit', targetDisplay: baseFileName || rawFilePath || 'file', rawTarget: rawFilePath || baseFileName, lineInfo };
    case 'createFile':
      return { iconKind: 'codeEdit', actionVerb: 'Create', targetDisplay: baseFileName || rawFilePath || 'file', rawTarget: rawFilePath || baseFileName, lineInfo };
    case 'createDoc': {
      const docFile = String(args.fileName || args.filename || args.filePath || args.path || '');
      const docTitle = String(args.title || '').trim();
      return { iconKind: 'createDoc', actionVerb: 'Create Doc', targetDisplay: getBaseName(docFile) || truncate(docTitle, 35), rawTarget: docFile || docTitle, filePath: docFile };
    }
    case 'deleteFile':
      return { iconKind: 'deleteFile', actionVerb: 'Delete', targetDisplay: baseFileName || rawFilePath || 'file', rawTarget: rawFilePath || baseFileName };
    case 'runCommand':
      return { iconKind: 'terminal', actionVerb: 'Run', targetDisplay: truncate(cmdText, 35), rawTarget: cmdText, isCommand: true };
    case 'sendTerminalInput': {
      const pid = String(args.processId || '');
      const typed = args.input !== undefined ? String(args.input) : '';
      const target = typed ? `"${truncate(typed, 18)}"${pid ? ` → ${pid}` : ''}` : pid;
      return { iconKind: 'terminal', actionVerb: 'Terminal Input', targetDisplay: target, rawTarget: typed ? `${typed} (${pid})` : pid, commandText: typed };
    }
    case 'checkTerminalStatus':
      return { iconKind: 'terminal', actionVerb: 'Terminal Status', targetDisplay: truncate(String(args.processId || ''), 35), rawTarget: String(args.processId || '') };
    case 'grepSearch':
    case 'semanticSearch': {
      const q = String(args.query || args.Query || args.concept || args.pattern || '');
      return { iconKind: 'codeSearch', actionVerb: 'Search', targetDisplay: quoteTruncate(q), rawTarget: q };
    }
    case 'searchWeb': {
      const q = String(args.query || args.Query || '');
      return { iconKind: 'webSearch', actionVerb: 'Web', targetDisplay: quoteTruncate(q), rawTarget: q };
    }
    case 'fetchWebPage': {
      const url = String(args.url || args.targetUrl || args.link || args.query || '');
      return { iconKind: 'fetchPage', actionVerb: 'Fetch', targetDisplay: url ? formatCompactUrl(url) : '', rawTarget: url };
    }
    case 'openBrowserPreview': {
      const url = String(args.url || '');
      return { iconKind: 'fetchPage', actionVerb: 'Preview', targetDisplay: url ? formatCompactUrl(url) : '', rawTarget: url };
    }
    case 'highlightBrowserElement': {
      const selector = String(args.selector || '');
      return { iconKind: 'fetchPage', actionVerb: 'Highlight', targetDisplay: truncate(selector, 35), rawTarget: selector };
    }
    case 'getChatHistory': {
      const numericLimit = Number(args.limit ?? args.n);
      const userOnly = args.userOnly !== false;
      const target = Number.isFinite(numericLimit) && numericLimit > 0
        ? `last ${numericLimit} ${userOnly ? 'user' : 'msgs'}`
        : userOnly ? 'user messages' : 'all messages';
      return { iconKind: 'chatHistory', actionVerb: 'Chat History', targetDisplay: target, rawTarget: target };
    }
    case 'submitPlan': {
      const planTitle = String(args.title || '').trim();
      return { iconKind: 'plan', actionVerb: 'Plan', targetDisplay: planTitle ? truncate(planTitle, 35) : 'Implementation Plan', rawTarget: planTitle || 'Implementation Plan' };
    }
    case 'queryConstitution': {
      const topic = String(args.topic || args.category || '').trim() || 'all';
      return { iconKind: 'plan', actionVerb: 'Constitution', targetDisplay: truncate(topic, 35), rawTarget: topic };
    }
    case 'updateConstitution': {
      const category = String(args.category || '').trim() || 'Constitution';
      return { iconKind: 'plan', actionVerb: 'Save Rule', targetDisplay: truncate(category, 35), rawTarget: String(args.rule_description || category) };
    }
    case 'readCoordination':
      return { iconKind: 'plan', actionVerb: 'Read Coordination', targetDisplay: '', rawTarget: '.exovon/coordination.json' };
    case 'updateCoordination': {
      const label = String(args.task || args.target_symbol || baseFileName || '').trim();
      return { iconKind: 'plan', actionVerb: 'Log Coordination', targetDisplay: truncate(label, 35), rawTarget: label };
    }
    case 'queryProjectMemory': {
      const mode = String(args.mode || 'auto').trim();
      const target = mode === 'recent' && args.count !== undefined
        ? `recent ${args.count}`
        : mode === 'specific' && args.index !== undefined
        ? `session #${args.index}`
        : mode;
      return { iconKind: 'memoryGraph', actionVerb: 'Memory', targetDisplay: truncate(target, 35), rawTarget: target };
    }
    case 'queryGraph': {
      const sym = String(args.symbolName || args.symbol || args.query || '').trim();
      return { iconKind: 'memoryGraph', actionVerb: 'Graph', targetDisplay: truncate(sym, 35), rawTarget: sym };
    }
    case 'querySemanticVector': {
      const concept = String(args.concept || args.query || '').trim();
      return { iconKind: 'memoryGraph', actionVerb: 'Vector Search', targetDisplay: quoteTruncate(concept), rawTarget: concept };
    }
    case 'getWorkspaceHash':
      return { iconKind: 'memoryGraph', actionVerb: 'Workspace Hash' };
    case 'generateImage': {
      const prompt = String(args.prompt || '').trim();
      return { iconKind: 'imageGen', actionVerb: 'Generate Image', targetDisplay: prompt ? quoteTruncate(prompt, 28) : baseFileName, rawTarget: prompt || rawFilePath };
    }
    case 'spawnSubAgent': {
      const task = String(args.taskDescription || args.task || '').trim();
      return { iconKind: 'subAgent', actionVerb: 'Sub-Agent', targetDisplay: truncate(task, 35), rawTarget: task };
    }
    case 'deployToExovonCloud': {
      const proj = String(args.projectId || '').trim() || 'Exovon Cloud';
      return { iconKind: 'cloudDeploy', actionVerb: 'Deploy', targetDisplay: proj, rawTarget: proj };
    }
    case 'listAvailableTools': {
      const cat = String(args.category || 'all').trim() || 'all';
      return { iconKind: 'toolbox', actionVerb: 'List Tools', targetDisplay: cat, rawTarget: cat };
    }
    default:
      return null;
  }
}

export function resolveToolStepMeta(input: ToolStepMetaInput): ResolvedToolStepMeta {
  const args = parseToolPayload(input.content);
  const filePath = String(
    input.filePath || args.relativePath || args.TargetFile || args.AbsolutePath ||
    args.SearchPath || args.DirectoryPath || args.filePath || args.outputPath ||
    args.file || args.path || args.directory || args.dir || ''
  );
  const baseFileName = getBaseName(filePath);
  const lineInfo = extractLineInfo(args, input.output, input.lineInfo);
  const cmdText = String(args.CommandLine || args.command || '');
  const canonical = canonicalizeToolName(input.toolName);
  const isCommand = canonical === 'runCommand' || Boolean(cmdText);

  const base: ResolvedToolStepMeta = {
    canonicalToolName: '',
    iconKind: 'toolbox',
    actionVerb: input.actionVerb || 'Tool',
    targetDisplay: '',
    rawTarget: '',
    lineInfo: '',
    filePath,
    parsedPayload: args,
    isCommand,
    commandText: cmdText || (typeof input.content === 'string' ? input.content : ''),
  };

  if (input.type === 'think') {
    return { ...base, iconKind: 'think', actionVerb: input.actionVerb || 'Think', filePath: '', isCommand: false, commandText: '' };
  }

  if (input.type === 'log') {
    const labelText = `${input.title || ''} ${input.content || ''}`;
    let iconKind: ToolIconKind = VALID_ICON_KINDS.has(input.iconKind || '') ? (input.iconKind as ToolIconKind) : 'log';
    if (iconKind === 'log') {
      if (input.id?.startsWith('auto-compact-') || labelText.includes('KV Compacted')) iconKind = 'compact';
      else if (labelText.includes('Plan approved') || labelText.includes('Plan submitted')) iconKind = 'plan';
    }
    return { ...base, iconKind, actionVerb: input.actionVerb || 'Log', targetDisplay: input.targetDisplay || '', filePath: '', isCommand: false, commandText: '' };
  }

  const matched = buildToolOverrides(canonical, args, filePath, baseFileName, lineInfo, cmdText);
  if (matched) {
    return { ...base, canonicalToolName: canonical, ...matched };
  }

  const rawName = input.toolName || '';
  const url = String(args.url || args.targetUrl || args.link || '');
  const genericQuery = String(args.query || args.concept || args.prompt || args.selector || args.symbolName || args.topic || args.task || '');
  const fallbackTarget = input.targetDisplay ||
    (url ? formatCompactUrl(url) : '') ||
    baseFileName ||
    (cmdText ? truncate(cmdText, 35) : '') ||
    (genericQuery ? quoteTruncate(genericQuery) : '');

  return {
    ...base,
    canonicalToolName: canonical,
    iconKind: rawName ? inferIconKindFromName(rawName) : (VALID_ICON_KINDS.has(input.iconKind || '') ? (input.iconKind as ToolIconKind) : 'toolbox'),
    actionVerb: rawName ? formatFallbackToolVerb(rawName) : (input.actionVerb || 'Tool'),
    targetDisplay: fallbackTarget,
    rawTarget: url || filePath || cmdText || genericQuery || fallbackTarget,
    lineInfo,
  };
}
