#!/usr/bin/env node
import fs from 'node:fs';

function buildSidebarDropBridge(wv, containerVar, fwdVar) {
  // Pure DOM + VS Code DataTransfer mime extraction with collision-proof `__xb_*` locals so minified VSCodium parameter names (e.g. `e`, `t`, `n`) never shadow.
  return [
    `let __xb_d=0,__xb_a=!1;`,
    `const __xb_set=__xb_v=>{__xb_a!==__xb_v&&(__xb_a=__xb_v,${wv}.postMessage({type:"externalDragState",active:__xb_v}))};`,
    `const __xb_reset=()=>{__xb_d=0,__xb_set(!1)};`,
    `const __xb_has=__xb_e=>{const __xb_t=__xb_e.dataTransfer;if(!__xb_t)return!1;const __xb_l=[...(__xb_t.types||[])].map(__xb_x=>__xb_x.toLowerCase());return["files","codefiles","resourceurls","codeeditors","application/vnd.code.uri-list","text/uri-list","text/plain"].some(__xb_k=>__xb_l.includes(__xb_k))||(__xb_t.files?.length??0)>0};`,
    `const __xb_allow=__xb_e=>{__xb_e.preventDefault(),__xb_e.stopImmediatePropagation(),__xb_e.dataTransfer&&(__xb_e.dataTransfer.dropEffect="copy")};`,
    `const __xb_toPath=__xb_u=>{if(!__xb_u)return"";if(typeof __xb_u=="object"){if(typeof __xb_u.fsPath=="string"&&__xb_u.fsPath)return __xb_u.fsPath;if(__xb_u.scheme&&__xb_u.scheme!=="file")return __xb_u.external||\`\${__xb_u.scheme}://\${__xb_u.authority||""}\${__xb_u.path||""}\`;let __xb_p=typeof __xb_u.path=="string"?__xb_u.path:"";if(__xb_u.authority)__xb_p=\`//\${__xb_u.authority}\${__xb_p}\`;return/^\\/[A-Za-z]:\\//.test(__xb_p)?__xb_p.slice(1).replace(/\\//g,"\\\\"):__xb_p}const __xb_s=String(__xb_u).trim();if(!__xb_s)return"";if(__xb_s.startsWith("file://"))try{const __xb_o=new URL(__xb_s);let __xb_p=decodeURIComponent(__xb_o.pathname||"");if(__xb_o.host)__xb_p=\`//\${__xb_o.host}\${__xb_p}\`;return/^\\/[A-Za-z]:\\//.test(__xb_p)?__xb_p.slice(1).replace(/\\//g,"\\\\"):__xb_p}catch{return __xb_s}return __xb_s};`,
    `const __xb_extract=__xb_e=>{const __xb_seen=new Set,__xb_paths=[],__xb_add=__xb_v=>{const __xb_t=__xb_v?.trim();__xb_t&&!__xb_seen.has(__xb_t)&&(__xb_seen.add(__xb_t),__xb_paths.push(__xb_t))};const __xb_dt=__xb_e.dataTransfer;if(__xb_dt){const __xb_ed=__xb_dt.getData("CodeEditors");if(__xb_ed)try{for(const __xb_i of JSON.parse(__xb_ed))__xb_add(__xb_toPath(__xb_i?.resource??__xb_i))}catch{}const __xb_ru=__xb_dt.getData("ResourceURLs");if(__xb_ru)try{for(const __xb_i of JSON.parse(__xb_ru))__xb_add(__xb_toPath(__xb_i))}catch{}const __xb_cf=__xb_dt.getData("CodeFiles");if(__xb_cf)try{for(const __xb_i of JSON.parse(__xb_cf))typeof __xb_i=="string"&&__xb_add(__xb_i)}catch{}if(__xb_dt.files)for(let __xb_i=0;__xb_i<__xb_dt.files.length;__xb_i++){const __xb_f=__xb_dt.files[__xb_i];typeof __xb_f?.path=="string"&&__xb_add(__xb_f.path)}if(__xb_paths.length===0){const __xb_ul=__xb_dt.getData("text/uri-list")||__xb_dt.getData("application/vnd.code.uri-list")||"";for(const __xb_ln of __xb_ul.split(/\\r?\\n/)){const __xb_t=__xb_ln.trim();__xb_t&&!__xb_t.startsWith("#")&&__xb_add(__xb_toPath(__xb_t))}}}const __xb_txt=__xb_paths.length===0?__xb_dt?.getData("text/plain"):void 0;return __xb_txt&&__xb_txt.trim()?{paths:__xb_paths,snippetText:__xb_txt}:{paths:__xb_paths}};`,
    `const __xb_on=(__xb_el,__xb_ev,__xb_fn)=>{__xb_el.addEventListener(__xb_ev,__xb_fn);this._webviewDisposables.add({dispose:()=>__xb_el.removeEventListener(__xb_ev,__xb_fn)})};`,
    `__xb_on(${containerVar},"dragenter",__xb_e=>{if(!__xb_has(__xb_e)){${fwdVar}(__xb_e);return}__xb_allow(__xb_e),__xb_d+=1,__xb_set(!0)});`,
    `__xb_on(${containerVar},"dragover",__xb_e=>{if(!__xb_a&&!__xb_has(__xb_e))return;__xb_allow(__xb_e),__xb_d===0&&(__xb_d=1),__xb_set(!0)});`,
    `__xb_on(${containerVar},"dragleave",__xb_e=>{if(!__xb_a&&!__xb_has(__xb_e)){${fwdVar}(__xb_e);return}__xb_e.preventDefault(),__xb_e.stopImmediatePropagation(),__xb_d=Math.max(0,__xb_d-1),__xb_d===0&&__xb_set(!1)});`,
    `__xb_on(${containerVar},"drop",__xb_e=>{if(!__xb_a&&!__xb_has(__xb_e))return;__xb_e.preventDefault(),__xb_e.stopImmediatePropagation(),__xb_reset();const __xb_p=__xb_extract(__xb_e);(__xb_p.paths.length>0||__xb_p.snippetText?.trim())&&${wv}.postMessage({type:"externalDropFiles",...__xb_p}),${wv}.windowDidDragEnd?.()});`,
    `for(const __xb_ev of["drag","dragstart"])__xb_on(${containerVar},__xb_ev,${fwdVar});`,
    `__xb_on(${containerVar},"dragend",__xb_e=>{__xb_reset(),${wv}.windowDidDragEnd?.(),${fwdVar}(__xb_e)});`,
    `const __xb_win=${containerVar}.ownerDocument?.defaultView||globalThis.window;__xb_win?.addEventListener&&__xb_on(__xb_win,"dragend",__xb_reset);`,
    `this._webviewDisposables.add({dispose:__xb_reset});`,
  ].join('');
}

const PATCHES = [
  {
    name: 'SIDEBAR_SIZE default 200 -> 460',
    alreadyRe: /SIDEBAR_SIZE:new\s+[A-Za-z0-9_$]+\("sideBar\.size",0,1,460\)/,
    unpatchedRe: /(SIDEBAR_SIZE:new\s+[A-Za-z0-9_$]+\("sideBar\.size",0,1,)200(\))/,
    apply: (src) => src.replace(
      /(SIDEBAR_SIZE:new\s+[A-Za-z0-9_$]+\("sideBar\.size",0,1,)200(\))/,
      '$1460$2',
    ),
  },
  {
    name: 'SIDEBAR_SIZE.defaultValue formula -> 45% capped at 460',
    alreadyRe: /\.SIDEBAR_SIZE\.defaultValue=Math\.min\(Math\.round\([A-Za-z0-9_$]+\.width\*\.45\),460\)/,
    unpatchedRe: /(\.SIDEBAR_SIZE\.defaultValue=)Math\.min\(300,([A-Za-z0-9_$]+\.width)\/4\)/,
    apply: (src) => src.replace(
      /(\.SIDEBAR_SIZE\.defaultValue=)Math\.min\(300,([A-Za-z0-9_$]+\.width)\/4\)/,
      '$1Math.min(Math.round($2*.45),460)',
    ),
  },
  {
    name: 'SidebarPart.preferredWidth floor 300 -> 460',
    alreadyRe: /fontSizeSettingsKey="workbench\.sideBar\.experimental\.fontSize"\}get snap\(\)\{return!0\}get preferredWidth\(\)\{[^}]*?return Math\.max\([A-Za-z0-9_$]+,460\)\}/,
    unpatchedRe: /(fontSizeSettingsKey="workbench\.sideBar\.experimental\.fontSize"\}get snap\(\)\{return!0\}get preferredWidth\(\)\{[^}]*?return Math\.max\([A-Za-z0-9_$]+,)300(\)\})/,
    apply: (src) => src.replace(
      /(fontSizeSettingsKey="workbench\.sideBar\.experimental\.fontSize"\}get snap\(\)\{return!0\}get preferredWidth\(\)\{[^}]*?return Math\.max\([A-Za-z0-9_$]+,)300(\)\})/,
      '$1460$2',
    ),
  },
  {
    name: 'WebviewElement._startBlockingIframeDragEvents pointerEvents -> none',
    alreadyRe: /_startBlockingIframeDragEvents\(\)\{this\.element&&\(this\.element\.style\.pointerEvents="none"\)\}/,
    unpatchedRe: /(_startBlockingIframeDragEvents\(\)\{this\.element&&\(this\.element\.style\.pointerEvents=)"auto"(\)\})/,
    apply: (src) => src.replace(
      /(_startBlockingIframeDragEvents\(\)\{this\.element&&\(this\.element\.style\.pointerEvents=)"auto"(\)\})/,
      '$1"none"$2',
    ),
  },
  {
    name: 'WebviewViewPane.activate exovonhub.sidebar drop bridge',
    alreadyRe: /this\.id==="exovonhub\.sidebar"/,
    unpatchedRe: /(this\._webviewDisposables\.add\(([A-Za-z0-9_$]+)\.onDidUpdateState\(\(\)=>\{this\.viewState\[[A-Za-z0-9_$]+\.webviewState\]=\2\.state\}\)\);let\s+([A-Za-z0-9_$]+)=\2\.container,([A-Za-z0-9_$]+)=\(?([A-Za-z0-9_$]+)\)?=>[\({]?\5\.preventDefault\(\),\5\.stopImmediatePropagation\(\),this\.dropTargetElement\.dispatchEvent\(new DragEvent\(\5\.type,\5\)\)[\)}]?);(for\(let\s+[A-Za-z0-9_$]+\s+of\[[^\]]+\]\)this\._webviewDisposables\.add\([^;]+\))/,
    apply(src) {
      return src.replace(this.unpatchedRe, (_full, prefix, wv, containerVar, fwdVar, _ev, elseLoop) => (
        `${prefix};if(this.id==="exovonhub.sidebar"){${buildSidebarDropBridge(wv, containerVar, fwdVar)}}else ${elseLoop}`
      ));
    },
  },
];

function patchWorkbench(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const patch of PATCHES) {
    if (patch.alreadyRe.test(content)) {
      console.log(`[already-applied] ${patch.name}`);
      continue;
    }
    if (!patch.unpatchedRe.test(content)) {
      throw new Error(`Pattern not found for workbench runtime patch: ${patch.name}`);
    }
    const next = patch.apply(content);
    if (next === content) {
      throw new Error(`Patch made no change: ${patch.name}`);
    }
    content = next;
    changed = true;
    console.log(`[patched] ${patch.name}`);
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/patch-workbench-runtime.mjs <workbench.desktop.main.js>');
  process.exit(1);
}

patchWorkbench(target);
