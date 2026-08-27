import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

import { getVsCodeApi } from './vscodeApi';

const vscodeApi = getVsCodeApi();

function extractModelMetadata(rawId: string, modelObj?: any) {
  const clean = (rawId || '').replace(/^local:/i, '');
  const basename = clean.split('/').pop() || clean;

  // Extract Params (e.g. 4x6B, 26B-A4B, 3.1B, 24B, 4B, 8B, 31B, 35B, 9B, 3B, 1B, etc.)
  let params = modelObj?.params || '';
  if (!params) {
    const pMatch = basename.match(/(\d+x\d+B|\d+B-A\d+B|\d+(?:\.\d+)?B)/i);
    if (pMatch) params = pMatch[1].toUpperCase();
  }

  // Extract Publisher (e.g. DavidAU, HauhauCS, Andycurrent, lmstudio-community, deepreinforce-ai, squ11z1, prithivMLmods, Nexlab, RHB56, bartowski, TheBloke, google, Qwen)
  let publisher = modelObj?.publisher || '';
  if (!publisher) {
    const segments = clean.split('/').filter(Boolean);
    const aiModelsIdx = segments.findIndex(s => s.toLowerCase().includes('model') || s.toLowerCase() === 'models');
    if (aiModelsIdx !== -1 && segments.length > aiModelsIdx + 1 && !segments[aiModelsIdx + 1].endsWith('.gguf')) {
      publisher = segments[aiModelsIdx + 1];
    } else if (segments.length >= 2 && !segments[segments.length - 2].toLowerCase().includes('model')) {
      publisher = segments[segments.length - 2];
    } else {
      const pubMatch = basename.match(/^(DavidAU|HauhauCS|Andycurrent|lmstudio-community|deepreinforce-ai|squ11z1|prithivMLmods|Nexlab|RHB56|bartowski|TheBloke|google|meta-llama|Qwen|Nexusflow|turboderp)/i);
      if (pubMatch) {
        publisher = pubMatch[1];
      } else {
        const parts = basename.split(/[-_]/);
        if (parts.length > 2 && !/^(qwen|gemma|llama|deepseek|mistral|vibe|mythos|ltx)/i.test(parts[0])) {
          publisher = parts[0];
        } else {
          publisher = 'Local';
        }
      }
    }
  }

  // Extract Quantization
  let quant = modelObj?.quantization || '';
  if (!quant) {
    const qMatch = basename.match(/(IQ[0-9]_[A-Z0-9_]+|Q[0-9]_[A-Z0-9_]+|Q[0-9]_[0-9]|F16|F32|BF16)/i);
    if (qMatch) quant = qMatch[1].toUpperCase();
    else quant = 'GGUF';
  }

  // Capabilities
  const isVision = /(vl|vision|llava|clip)/i.test(basename) || /(vl|vision)/i.test(clean);
  const isToolUse = /(it|instruct|chat|tool|heretic|neo|freedom|uncensored|agent)/i.test(basename) || /(it|instruct)/i.test(clean);
  const isReasoning = /(think|reason|freedom|r1|deepseek)/i.test(basename);
  const isEmbedding = /(embed|bge|nomic)/i.test(basename);

  // Modified Time
  let modified = modelObj?.modified || modelObj?.mtime_display || '';
  if (!modified && modelObj?.mtime) {
    const diffMs = Date.now() - new Date(modelObj.mtime).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) modified = `${diffDays} days ago`;
    else if (diffHours > 0) modified = `${diffHours} hours ago`;
    else modified = 'Just now';
  }
  if (!modified) {
    modified = 'Recently';
  }

  return {
    name: basename,
    params,
    publisher,
    quant,
    isVision,
    isToolUse,
    isReasoning,
    isEmbedding,
    modified
  };
}

function formatModelDisplayName(modelStr?: string): string {
  if (!modelStr) return '';
  let name = modelStr.replace(/^local:/i, '');
  const parts = name.split(/[\/]/);
  name = parts[parts.length - 1] || name;
  name = name.replace(/\.gguf$/i, '');
  return name;
}

interface HfLiveModel {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  pipeline_tag?: string;
  tags?: string[];
}

interface HfModelDetails {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  pipeline_tag?: string;
  tags?: string[];
  gguf?: {
    architecture?: string;
    context_length?: number;
    total?: number;
  };
  cardData?: {
    license?: string;
    language?: string[];
    base_model?: string[];
  };
  siblings?: Array<{ rfilename: string; size?: number; lfs?: { size?: number; sha256?: string } }>;
}

interface LiveQuantOption {
  filename: string;
  quant: string;
  sizeGB: number;
  sizeDisplay: string;
  directUrl: string;
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return 'Recently';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return 'Just now';
  } catch {
    return 'Recently';
  }
}

function renderProviderLogo(modelId: string) {
  const lower = modelId.toLowerCase();
  if (lower.includes('qwen') || lower.includes('alibaba')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-300 flex-shrink-0">
        <span className="font-bold text-xs">Q</span>
      </div>
    );
  }
  if (lower.includes('meta') || lower.includes('llama')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-blue-400 flex-shrink-0">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16.994 6.002c-1.892 0-3.32 1.058-4.994 3.013C10.326 7.06 8.898 6.002 7.006 6.002 3.864 6.002 1.5 8.536 1.5 12c0 3.464 2.364 5.998 5.506 5.998 2.052 0 3.593-1.185 4.994-3.09 1.401 1.905 2.942 3.09 4.994 3.09 3.142 0 5.506-2.534 5.506-5.998 0-3.464-2.364-5.998-5.506-5.998zm0 9.77c-1.884 0-3.308-1.745-4.494-3.772 1.186-2.027 2.61-3.772 4.494-3.772 1.884 0 3.28 1.574 3.28 3.772 0 2.198-1.396 3.772-3.28 3.772zm-9.988 0c-1.884 0-3.28-1.574-3.28-3.772 0-2.198 1.396-3.772 3.28-3.772 1.884 0 3.308 1.745 4.494 3.772-1.186 2.027-2.61 3.772-4.494 3.772z"/>
        </svg>
      </div>
    );
  }
  if (lower.includes('google') || lower.includes('gemma')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center flex-shrink-0">
        <span className="font-bold text-xs text-amber-400">G</span>
      </div>
    );
  }
  if (lower.includes('deepseek')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-sky-400 flex-shrink-0">
        <span className="font-bold text-xs">DS</span>
      </div>
    );
  }
  if (lower.includes('mistral') || lower.includes('mixtral')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-amber-500 flex-shrink-0">
        <span className="font-bold text-xs">M</span>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-400 flex-shrink-0">
      <span className="text-xs">🤗</span>
    </div>
  );
}

export default function SettingsApp() {
  const [activeTab, setActiveTab] = useState('Quota');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [tokenQuota, setTokenQuota] = useState<number | string>('...');
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [membershipType, setMembershipType] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('Exovon Cloud Sync');
  const [email, setEmail] = useState<string | null>(null);
  const [usedPercentage, setUsedPercentage] = useState<number>(0);
  const [dailyLimit, setDailyLimit] = useState<number>(0);
  const [tokensUsed, setTokensUsed] = useState<number>(0);
  const [resetsIn, setResetsIn] = useState<string>('...');
  const [showQuotaDetails, setShowQuotaDetails] = useState<boolean>(false);

  interface ModelRate {
    id: string;
    displayName: string;
    requiresPro: boolean;
    tierColor: string;
    percentage: number;
  }
  const [modelRates, setModelRates] = useState<ModelRate[]>([]);  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'workspaceInfo') {
        setIsLoggedIn(message.isLoggedIn);
        setTokenQuota(message.tokenQuota);
        setProfilePic(message.profilePic || null);
        setMembershipType(message.membershipType || 'Free');
        setDisplayName(message.displayName || message.email || 'Astrolabe User');
        setEmail(message.email || null);
        if (message.usedPercentage !== undefined) setUsedPercentage(message.usedPercentage);
        if (message.dailyLimit !== undefined) setDailyLimit(message.dailyLimit);
        if (message.tokensUsed !== undefined) setTokensUsed(message.tokensUsed);
        if (message.resetsIn !== undefined) setResetsIn(message.resetsIn);
        
        if (message.modelRates) {
          setModelRates(message.modelRates);
        }
      } else if (message.type === 'settingsState') {
        // model state is now handled in App.tsx chat footer
      }
    };
    window.addEventListener('message', handleMessage);

    // Request initial state
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'getWorkspaceInfo' });
      vscodeApi.postMessage({ command: 'getSettingsState' });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const tabs = ['Agent', 'Notifications', 'Quota', 'Customizations', 'Browser', 'Local Engine'];

  interface LocalModel {
    id: string;
    name?: string;
    size_display?: string;
    size_bytes?: number;
    max_context_length?: number;
    total_layers?: number;
    architecture?: string;
    quantization?: string;
    loaded?: boolean;
  }
  
  interface DownloadProgress {
    model_name: string;
    downloaded_bytes: number;
    total_bytes: number;
    percent: number;
    speed_bytes_per_sec?: number;
    speed_display?: string;
    eta_seconds?: number;
    status: string;
  }
  
  interface HfSearchResult {
    id: string;
    downloads?: number;
  }

  const [daemonRunning, setDaemonRunning] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<DownloadProgress[]>([]);
  const [activeLocalModel, setActiveLocalModel] = useState<string>('');
  const [localModelsDir, setLocalModelsDir] = useState<string>('~/.exovon/models');

  const [hfSearchQuery, setHfSearchQuery] = useState('');
  const [hfSearchResults, setHfSearchResults] = useState<HfSearchResult[]>([]);
  const [isSearchingHf, setIsSearchingHf] = useState(false);
  const [hfSearchPage, setHfSearchPage] = useState(0);
  const [hasMoreHfResults, setHasMoreHfResults] = useState(true);

  // Load Model Modal State
  const [loadModelModalOpen, setLoadModelModalOpen] = useState(false);
  const [selectedModelToLoad, setSelectedModelToLoad] = useState<string>('');
  const [loadBackend, setLoadBackend] = useState<'llama.cpp' | 'sglang'>('llama.cpp');
  const [ctxSize, setCtxSize] = useState<number>(8192);
  const [nGPULayers, setNGPULayers] = useState<number>(33);
  const [nThreads, setNThreads] = useState<number>(4);
  const [nBatch, setNBatch] = useState<number>(2048);
  const [nUbatch, setNUbatch] = useState<number>(512);
  const [directGpuMemory, setDirectGpuMemory] = useState<boolean>(true);
  const [flashAttn, setFlashAttn] = useState<boolean>(true);
  const [maxTokens, setMaxTokens] = useState<number>(16384);

  // Live Model Loading Progress State
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [loadProgressPercent, setLoadProgressPercent] = useState<number>(0);
  const [loadStatusMessage, setLoadStatusMessage] = useState<string>('');

  const [daemonHealth, setDaemonHealth] = useState<any>(null);
  const [modelFilterQuery, setModelFilterQuery] = useState('');
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Live Hugging Face API States
  const [sidebarModelSearch, setSidebarModelSearch] = useState('');
  const [isModelHubOpen, setIsModelHubOpen] = useState(false);
  const [hubSearchQuery, setHubSearchQuery] = useState('');
  const [hubSortMode, setHubSortMode] = useState<'lastModified' | 'trendingScore' | 'downloads'>('lastModified');
  const [liveModelsList, setLiveModelsList] = useState<HfLiveModel[]>([]);
  const [isLoadingModelsList, setIsLoadingModelsList] = useState(false);
  const [selectedHubModelId, setSelectedHubModelId] = useState<string>('');
  const [selectedModelDetails, setSelectedModelDetails] = useState<HfModelDetails | null>(null);
  const [modelReadme, setModelReadme] = useState<string>('');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [availableQuants, setAvailableQuants] = useState<LiveQuantOption[]>([]);
  const [selectedQuantIndex, setSelectedQuantIndex] = useState<number>(0);
  const [copiedRepoId, setCopiedRepoId] = useState(false);

  // Speed and ETA calculation helper
  const prevDownloadsRef = useRef<{ [key: string]: { bytes: number; time: number; speed: string; eta: string } }>({});

  const formatSpeedStr = (bytesPerSec: number): string => {
    if (bytesPerSec >= 1024 * 1024) {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    } else if (bytesPerSec >= 1024) {
      return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    }
    return `${bytesPerSec.toFixed(0)} B/s`;
  };

  const formatEtaStr = (seconds: number): string => {
    if (seconds <= 0 || !isFinite(seconds)) return '';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  };

  const getSpeedAndEta = (dl: DownloadProgress) => {
    if (dl.speed_display) {
      const eta = dl.eta_seconds ? formatEtaStr(dl.eta_seconds) : '';
      return { speed: dl.speed_display, eta };
    }

    const now = Date.now();
    const prev = prevDownloadsRef.current[dl.model_name];
    if (prev && (dl.status === 'downloading' || dl.status === 'starting')) {
      const timeDiff = (now - prev.time) / 1000;
      if (timeDiff >= 0.7) {
        const bytesDiff = dl.downloaded_bytes - prev.bytes;
        if (bytesDiff > 0) {
          const speedNum = bytesDiff / timeDiff;
          const speedStr = formatSpeedStr(speedNum);
          const remainingBytes = Math.max(0, dl.total_bytes - dl.downloaded_bytes);
          const etaSecs = speedNum > 0 ? remainingBytes / speedNum : 0;
          const etaStr = formatEtaStr(etaSecs);
          prevDownloadsRef.current[dl.model_name] = { bytes: dl.downloaded_bytes, time: now, speed: speedStr, eta: etaStr };
          return { speed: speedStr, eta: etaStr };
        }
      }
      return { speed: prev.speed || '', eta: prev.eta || '' };
    }

    prevDownloadsRef.current[dl.model_name] = { bytes: dl.downloaded_bytes, time: now, speed: '', eta: '' };
    return { speed: '', eta: '' };
  };

  // 1. Fetch live models list directly from Hugging Face API
  const fetchLiveModels = async (sortMode: 'lastModified' | 'trendingScore' | 'downloads', search?: string) => {
    setIsLoadingModelsList(true);
    try {
      let url = `https://huggingface.co/api/models?filter=gguf&sort=${sortMode}&direction=-1&limit=30`;
      if (search && search.trim()) {
        url = `https://huggingface.co/api/models?search=${encodeURIComponent(search.trim())}&filter=gguf&sort=downloads&direction=-1&limit=30`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLiveModelsList(data);
          if (data.length > 0) {
            const firstId = data[0].id;
            setSelectedHubModelId(firstId);
            fetchModelDetails(firstId);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch Hugging Face models:', err);
    } finally {
      setIsLoadingModelsList(false);
    }
  };

  // 2. Fetch live model details and real README from Hugging Face API
  const fetchModelDetails = async (modelId: string) => {
    if (!modelId) return;
    setIsLoadingDetails(true);
    setSelectedHubModelId(modelId);
    setSelectedQuantIndex(0);
    try {
      const [infoRes, readmeRes] = await Promise.all([
        fetch(`https://huggingface.co/api/models/${modelId}?blobs=true`),
        fetch(`https://huggingface.co/${modelId}/raw/main/README.md`)
      ]);

      if (infoRes.ok) {
        const info = await infoRes.json() as HfModelDetails;
        setSelectedModelDetails(info);

        // Extract real .gguf siblings from repo tree with real byte sizes
        const ggufFiles = (info.siblings || []).filter(s => s.rfilename && s.rfilename.toLowerCase().endsWith('.gguf'));
        const quants: LiveQuantOption[] = ggufFiles.map(f => {
          const fn = f.rfilename;
          const quantMatch = fn.match(/(Q\d+_[A-Za-z0-9_]+|IQ\d+_[A-Za-z0-9_]+|F16|F32|Q8_0|Q4_0|Q4_1|Q5_0|Q5_1|BF16|NVFP4|FP8|FP4)/i);
          const quant = quantMatch ? quantMatch[1].toUpperCase() : 'GGUF';
          const rawBytes = f.lfs?.size || f.size || 0;
          let sizeGB = 0;
          let sizeDisplay = '';
          if (rawBytes > 0) {
            sizeGB = Number((rawBytes / (1024 * 1024 * 1024)).toFixed(2));
            if (sizeGB >= 1.0) {
              sizeDisplay = `${sizeGB} GB`;
            } else {
              const sizeMB = Number((rawBytes / (1024 * 1024)).toFixed(0));
              sizeDisplay = `${sizeMB} MB`;
            }
          } else {
            const paramMatch = (fn + ' ' + modelId).match(/(\d+(\.\d+)?B)/i);
            const param = paramMatch ? parseFloat(paramMatch[1]) : 7;
            sizeGB = Number((param * 0.58).toFixed(1));
            sizeDisplay = `~${sizeGB} GB`;
          }
          return {
            filename: fn,
            quant,
            sizeGB,
            sizeDisplay,
            directUrl: `https://huggingface.co/${modelId}/resolve/main/${fn}`
          };
        });

        // Fallback default quant if siblings list is empty
        if (quants.length === 0) {
          const baseName = modelId.split('/').pop() || 'model';
          quants.push({
            filename: `${baseName.toLowerCase()}-q4_k_m.gguf`,
            quant: 'Q4_K_M',
            sizeGB: 4.8,
            sizeDisplay: '4.8 GB',
            directUrl: `https://huggingface.co/${modelId}`
          });
        }

        setAvailableQuants(quants);
      }

      if (readmeRes.ok) {
        const rawReadme = await readmeRes.text();
        const cleanReadme = rawReadme.replace(/^---[\s\S]*?---/, '').trim();
        setModelReadme(cleanReadme || 'No README provided for this repository.');
      } else {
        setModelReadme('No README provided for this repository.');
      }
    } catch (err) {
      console.error('Failed to fetch model details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const openModelHubWithQuery = (query: string = '') => {
    setHubSearchQuery(query);
    setSidebarModelSearch(query);
    setIsModelHubOpen(true);
    fetchLiveModels(hubSortMode, query);
  };

  // Keyboard shortcut (Ctrl+F / Cmd+F) to focus filter input and click listener to close menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (activeTab === 'Local Engine') {
          e.preventDefault();
          filterInputRef.current?.focus();
          filterInputRef.current?.select();
        }
      } else if (e.key === 'Escape') {
        setActiveActionMenuId(null);
      }
    };

    const handleClickOutside = () => {
      setActiveActionMenuId(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [activeTab]);

  useEffect(() => {
    // Request initial daemon status and local models config
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'getDaemonStatus' });
    }
  }, []);

  const [localSystemPrompt, setLocalSystemPrompt] = useState<string>('');
  const [isPromptSaved, setIsPromptSaved] = useState<boolean>(false);

  useEffect(() => {
    const handleEvents = (event: MessageEvent) => {
      if (event.data.type === 'daemonStatus') {
        setDaemonRunning(event.data.isRunning);
      } else if (event.data.type === 'localModels') {
        setLocalModels(event.data.models || []);
      } else if (event.data.type === 'settingsState') {
        if (event.data.localLlmModelName) setActiveLocalModel(event.data.localLlmModelName);
        if (event.data.localModelsDirectory) setLocalModelsDir(event.data.localModelsDirectory);
        if (event.data.localModelSystemPrompt !== undefined) {
          setLocalSystemPrompt(event.data.localModelSystemPrompt);
          setIsPromptSaved(false);
        }
      } else if (event.data.type === 'hfSearchResults') {
        const results = event.data.results || [];
        if (event.data.page > 0) {
          setHfSearchResults(prev => [...prev, ...results]);
        } else {
          setHfSearchResults(results);
        }
        setHasMoreHfResults(results.length === 10);
        setIsSearchingHf(false);
      } else if (event.data.type === 'modelLoadProgress') {
        setLoadingModelId(event.data.modelId);
        setLoadProgressPercent(event.data.percent || 0);
        setLoadStatusMessage(event.data.message || 'Loading model...');
      } else if (event.data.type === 'modelLoaded') {
        setLoadingModelId(null);
        setLoadProgressPercent(100);
        setLoadStatusMessage('');
        vscodeApi?.postMessage({ command: 'getLocalModels' });
      } else if (event.data.type === 'modelLoadError') {
        setLoadingModelId(null);
        setLoadProgressPercent(0);
        setLoadStatusMessage('');
        vscodeApi?.postMessage({ command: 'getLocalModels' });
      } else if (event.data.type === 'modelUnloaded') {
        vscodeApi?.postMessage({ command: 'getLocalModels' });
      } else if (event.data.type === 'daemonHealth') {
        setDaemonHealth(event.data.health);
      } else if (event.data.type === 'activeDownloads') {
        setActiveDownloads(event.data.downloads || []);
      }
    };
    window.addEventListener('message', handleEvents);
    return () => window.removeEventListener('message', handleEvents);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setTimeout>;
    if (activeTab === 'Local Engine' && vscodeApi) {
      vscodeApi.postMessage({ command: 'getLocalModels' });
      
      interval = setInterval(() => {
        if (daemonRunning) {
          vscodeApi.postMessage({ command: 'getDaemonHealth' });
          vscodeApi.postMessage({ command: 'getActiveDownloads' });
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTab, daemonRunning]);

  return (
    <div className="flex h-screen w-full bg-transparent text-zinc-100 font-sans select-none">
      {/* Left Sidebar */}
      <div className="w-64 glass-panel-dark flex flex-col p-4 shrink-0 overflow-y-auto border-r border-white/10">
        <h1 className="text-sm font-bold glass-text-reflection mb-6 uppercase tracking-wider">Settings</h1>

        <div className="space-y-1 mb-6">
          <button
            className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-all ${activeTab === 'Account' ? 'glass-component-white text-white font-bold shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            onClick={() => setActiveTab('Account')}
          >
            Account
          </button>
        </div>

        <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 px-3">IDE Core</h2>
        <div className="space-y-1 mb-6">
          <button
            className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all hover:bg-white/10 text-zinc-300 hover:text-white flex items-center justify-between group"
            onClick={() => vscodeApi?.postMessage({ command: 'openNativeSettings' })}
          >
            <span>Settings (UI)</span>
            <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all hover:bg-white/10 text-zinc-300 hover:text-white flex items-center justify-between group"
            onClick={() => vscodeApi?.postMessage({ command: 'openKeybindings' })}
          >
            <span>Keyboard Shortcuts</span>
            <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all hover:bg-white/10 text-zinc-300 hover:text-white flex items-center justify-between group"
            onClick={() => vscodeApi?.postMessage({ command: 'selectTheme' })}
          >
            <span>Color Theme</span>
            <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all hover:bg-white/10 text-zinc-300 hover:text-white flex items-center justify-between group"
            onClick={() => vscodeApi?.postMessage({ command: 'showCommandPalette' })}
          >
            <span>Command Palette</span>
            <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </button>
        </div>

        <div className="flex items-center justify-between mb-2 px-3">
          <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Astrolabe</h2>
        </div>

        {/* Sidebar Search Bar for Models */}
        <div className="px-1 mb-2">
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input 
              type="text"
              placeholder="Search Hugging Face..."
              value={sidebarModelSearch}
              onChange={(e) => setSidebarModelSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  openModelHubWithQuery(sidebarModelSearch);
                }
              }}
              onClick={() => {
                if (!isModelHubOpen) {
                  openModelHubWithQuery(sidebarModelSearch);
                }
              }}
              className="w-full bg-zinc-950/80 border border-white/10 rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-sky-500/50 transition-all"
            />
          </div>
        </div>

        {/* Discover Models Hub Launch Button */}
        <div className="px-1 mb-2">
          <button
            onClick={() => openModelHubWithQuery('')}
            className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 border border-white/5 flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>Discover Models</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Hub</span>
          </button>
        </div>

        <div className="space-y-1">
          {tabs.map(tab => (
            <button
              key={tab}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-all ${activeTab === tab ? 'glass-component-white text-white font-bold shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8 w-full min-w-0">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-bold text-white tracking-wide">Settings - {activeTab}</h2>
          <button 
            onClick={() => vscodeApi?.postMessage({ command: 'getWorkspaceInfo' })}
            className="glass-btn px-4 py-1.5 rounded-xl text-xs font-semibold"
          >
            Refresh
          </button>
        </div>

        {activeTab === 'Quota' && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Model Quota</h3>
              <div 
                className="glass-panel-dark rounded-2xl p-6 cursor-pointer border border-white/10 hover:border-white/20 transition-all relative overflow-hidden group shadow-2xl"
                onClick={() => setShowQuotaDetails(!showQuotaDetails)}
              >
                {/* Background ambient glow based on usage */}
                <div 
                  className={`absolute inset-0 opacity-10 transition-colors duration-700 ${usedPercentage > 90 ? 'bg-red-500' : usedPercentage > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                ></div>

                <div className="p-8 flex flex-col items-center justify-center relative z-10">
                  {/* Circular Progress Ring */}
                  <div className="relative w-48 h-48 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                      {/* Background Track */}
                      <circle 
                        cx="50" cy="50" r="42" 
                        fill="transparent" 
                        stroke="#27272a" 
                        strokeWidth="8" 
                      />
                      {/* Progress Ring */}
                      <circle 
                        cx="50" cy="50" r="42" 
                        fill="transparent" 
                        stroke={usedPercentage > 90 ? '#ef4444' : usedPercentage > 75 ? '#f59e0b' : '#10b981'} 
                        strokeWidth="8" 
                        strokeLinecap="round"
                        strokeDasharray="263.89"
                        strokeDashoffset={263.89 - (263.89 * Math.min(100, usedPercentage)) / 100}
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    
                    {/* Inner Content */}
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold text-white tracking-tight">
                        {usedPercentage.toFixed(1)}<span className="text-lg text-zinc-500">%</span>
                      </span>
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Used</span>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 mt-6 flex items-center gap-2 group-hover:text-zinc-300 transition-colors">
                    <span>Tap to {showQuotaDetails ? 'hide' : 'view'} details</span>
                    <svg className={`w-3 h-3 transition-transform duration-300 ${showQuotaDetails ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </p>
                </div>

                {/* Expanded Details */}
                <div className={`overflow-hidden transition-all duration-500 ease-in-out ${showQuotaDetails ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="p-6 bg-zinc-900/50 flex flex-col gap-4">
                    <div className="flex justify-between items-center pb-3 border-b border-zinc-800/50">
                      <span className="text-sm text-zinc-400">Remaining Balance</span>
                      <span className="text-emerald-400 font-mono text-lg font-medium">{tokenQuota}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-zinc-800/50">
                      <span className="text-sm text-zinc-400">Tokens Used</span>
                      <span className="text-zinc-200 font-mono">{tokensUsed.toLocaleString()} / {dailyLimit.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-zinc-400">Quota Resets In</span>
                      <span className="text-zinc-200 font-mono text-sm">{resetsIn}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {activeTab === 'Account' && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div>
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Profile</h3>
              <div className="bg-zinc-900/50 backdrop-blur-md border border-white/5 shadow-2xl rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                    {isLoggedIn && profilePic ? (
                      <img src={profilePic} alt="Profile" className="w-16 h-16 rounded-full border-2 border-white/10 object-cover shadow-lg" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center border-2 border-white/5 shadow-lg">
                        <svg className="w-7 h-7 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      </div>
                    )}
                    <div>
                      <div className="flex flex-col">
                        <h4 className="text-lg font-semibold text-white tracking-wide">{isLoggedIn ? displayName : 'Astrolabe User'}</h4>
                        {isLoggedIn && email && displayName !== email && (
                          <span className="text-[10px] text-zinc-500 font-mono tracking-wider">{email}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-md border border-white/5">
                          <span className={`w-1.5 h-1.5 rounded-full ${isLoggedIn ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`}></span>
                          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">{isLoggedIn ? 'Online' : 'Offline'}</span>
                        </div>
                        {isLoggedIn && membershipType && (
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/20 text-[10px] font-bold text-violet-400 uppercase tracking-widest">
                              {membershipType.replace(' + Hosting', '')} Plan
                            </span>
                            <span className={`px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${membershipType.toLowerCase().includes('hosting') ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500'}`}>
                              {membershipType.toLowerCase().includes('hosting') ? '🌍 Hosting Enabled' : 'No Hosting'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {isLoggedIn ? (
                      <button
                        onClick={() => vscodeApi?.postMessage({ command: 'logout' })}
                        className="bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-all active:scale-95"
                      >
                        Sign Out
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => vscodeApi?.postMessage({ command: 'pasteAuthToken' })}
                          className="bg-zinc-800 text-zinc-300 border border-zinc-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
                        >
                          Paste Token
                        </button>
                        <button
                          onClick={() => vscodeApi?.postMessage({ command: 'login' })}
                          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-500 transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
                        >
                          Sign In via Web
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Tiers Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Available Upgrades</h3>
                <span className="text-[10px] text-zinc-500">Billed via exovon.in/payments</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Free Plan */}
                <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-5 flex flex-col justify-between hover:border-white/10 transition-colors">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">Free</h4>
                    <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Basic agent access. No edge hosting included.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'free' })} className="mt-6 w-full py-2 rounded-lg text-xs font-bold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors">Current Plan</button>
                </div>

                {/* Pro Plan */}
                <div className="bg-zinc-900/30 border border-violet-500/20 rounded-2xl p-5 flex flex-col justify-between hover:border-violet-500/40 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/10 blur-2xl rounded-full group-hover:bg-violet-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <h4 className="text-sm font-bold text-violet-400 uppercase tracking-widest">Astrolabe Pro</h4>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Advanced reasoning models and unlimited local context.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'pro' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-900/20 transition-colors">Upgrade to Pro</button>
                </div>

                {/* Pro + Hosting Plan */}
                <div className="bg-gradient-to-b from-zinc-900/80 to-zinc-900/30 border border-blue-500/30 rounded-2xl p-5 flex flex-col justify-between hover:border-blue-500/50 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 blur-2xl rounded-full group-hover:bg-blue-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-bold text-violet-400 uppercase tracking-widest">Pro</h4>
                      <span className="text-[10px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded uppercase tracking-wider">+ Hosting</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Everything in Pro, plus 1-click global edge hosting deployments.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'pro_hosting' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 transition-colors">Upgrade to Pro+Hosting</button>
                </div>

                {/* Enterprise Plan */}
                <div className="bg-zinc-900/30 border border-amber-500/20 rounded-2xl p-5 flex flex-col justify-between hover:border-amber-500/40 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 blur-2xl rounded-full group-hover:bg-amber-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <h4 className="text-sm font-bold text-amber-400 uppercase tracking-widest">Enterprise</h4>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Custom fine-tuning and organizational vector databases.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'enterprise' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-900/20 transition-colors">Upgrade to Enterprise</button>
                </div>

                {/* Enterprise + Hosting Plan */}
                <div className="bg-gradient-to-b from-zinc-900/80 to-zinc-900/30 border border-emerald-500/30 rounded-2xl p-5 flex flex-col justify-between hover:border-emerald-500/50 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 blur-2xl rounded-full group-hover:bg-emerald-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-bold text-amber-400 uppercase tracking-widest">Enterprise</h4>
                      <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded uppercase tracking-wider">+ Hosting</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Complete organization suite with dedicated edge fleet nodes.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'enterprise_hosting' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 transition-colors">Upgrade to Enterprise+Hosting</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Quota' && (
          <div className="space-y-6">
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-3xl rounded-full"></div>
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center justify-between relative z-10">
                <span>Daily Compute Quota</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">Resets at Midnight</span>
              </h3>
              
              {/* Progress Bar */}
              <div className="mb-8 relative z-10">
                <div className="flex items-end justify-between mb-2">
                  <span className="text-3xl font-black text-white tracking-tighter">0%</span>
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Used</span>
                </div>
                <div className="w-full bg-zinc-950 rounded-full h-3 border border-white/5 overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-3 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.5)] transition-all" style={{ width: '0%' }}></div>
                </div>
              </div>

              {/* Model Burn Rates */}
              <div className="space-y-3 relative z-10">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Daily API Burn Rate (Relative to Free Quota)</h4>
                
                {modelRates && modelRates.length > 0 ? (
                  modelRates.map((m: ModelRate) => (
                    <div key={m.id} className={`flex items-center justify-between p-3 rounded-xl bg-${m.tierColor}-500/5 border border-${m.tierColor}-500/10 relative overflow-hidden group`}>
                      <div className="flex items-center gap-3 relative z-10">
                        <div className={`w-2 h-2 rounded-full bg-${m.tierColor}-500 shadow-[0_0_10px_rgba(var(--tw-colors-${m.tierColor}-500),0.8)]`}></div>
                        <span className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                          {m.displayName}
                          {m.requiresPro && (
                            <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider border border-amber-500/20">Pro</span>
                          )}
                        </span>
                      </div>
                      <span className={`text-xs font-black text-${m.tierColor}-400 tracking-wider relative z-10`}>{m.percentage}%</span>
                      {/* Hover effect background */}
                      <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-${m.tierColor}-500/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700`}></div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center border border-dashed border-white/10 rounded-xl">
                    <p className="text-xs text-zinc-500 animate-pulse">Syncing dynamic quota rates from Exovon Cloud...</p>
                  </div>
                )}
              </div>

              <div className="mt-8 flex justify-center relative z-10">
                <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass' })} className="px-6 py-2.5 rounded-lg text-xs font-bold text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 shadow-lg transition-all active:scale-95 flex items-center gap-2">
                  <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  Upgrade Monthly Base Plan
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Agent' && (
          <div className="space-y-6">
            {/* 1. Local Agent System Instruction Editor */}
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-wide uppercase">Local Model System Instruction</h3>
                    <p className="text-xs text-zinc-400 mt-0.5">Model-aware agent instructions for local SLMs & LLMs (Qwen 2.5 Coder, Llama 3, DeepSeek, Gemma).</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${
                    Math.round(localSystemPrompt.length / 3.8) <= 650 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    ~{Math.round(localSystemPrompt.length / 3.8)} tokens {Math.round(localSystemPrompt.length / 3.8) <= 650 ? '(Calibrated 500-600)' : '(High)'}
                  </span>
                </div>
              </div>

              <p className="text-xs text-zinc-500 mb-3">
                A compact, structured prompt (~500-600 tokens) preserves 90%+ of your local model's KV context for code, enforces deterministic tool calling, and eliminates hallucinations.
              </p>

              <textarea 
                className="w-full h-80 bg-zinc-950 border border-white/10 rounded-xl p-4 text-xs font-mono text-zinc-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition-all resize-y leading-relaxed"
                value={localSystemPrompt}
                onChange={e => {
                  setLocalSystemPrompt(e.target.value);
                  setIsPromptSaved(false);
                }}
                placeholder="Enter local model system instructions..."
              ></textarea>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {isPromptSaved && (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Instruction saved successfully
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => {
                      if (vscodeApi) {
                        vscodeApi.postMessage({ command: 'resetLocalModelSystemPrompt' });
                      }
                    }}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold border border-white/5 transition-all"
                  >
                    Reset to Default
                  </button>
                  <button 
                    onClick={() => {
                      if (vscodeApi) {
                        vscodeApi.postMessage({ command: 'updateLocalModelSystemPrompt', prompt: localSystemPrompt });
                        setIsPromptSaved(true);
                      }
                    }}
                    className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-violet-600/30 transition-all flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                    Save Instruction
                  </button>
                </div>
              </div>
            </div>

            {/* 2. Agent Behaviors & Autonomous Mode */}
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                Agent Behaviors
              </h3>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Autonomous Execution Mode</h4>
                    <p className="text-xs text-zinc-500 mt-1">Allow agent to run safe terminal commands without asking.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
                  </label>
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">System Constitution</h4>
                  <p className="text-xs text-zinc-500 mb-4">Provide global custom instructions the agent must strictly follow across all workspaces.</p>
                  <textarea 
                    className="w-full h-32 bg-zinc-950 border border-white/10 rounded-xl p-4 text-sm text-zinc-300 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition-all resize-none font-mono text-xs"
                    placeholder="e.g. Always use functional React components. Never use Tailwind unless requested..."
                  ></textarea>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Notifications' && (
          <div className="space-y-6">
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                Alerts & Logging
              </h3>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Task Completion Sounds</h4>
                    <p className="text-xs text-zinc-500 mt-1">Play a subtle chime when the agent finishes executing a plan.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>

                <div className="border-t border-white/5 pt-6 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Desktop Push Notifications</h4>
                    <p className="text-xs text-zinc-500 mt-1">Receive OS-level notifications for critical agent errors or success.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>

                <div className="border-t border-white/5 pt-6 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Verbose Thinking Loops</h4>
                    <p className="text-xs text-zinc-500 mt-1">Show full background reasoning logs in the chat interface.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Customizations' && (
          <div className="space-y-6">
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
                Appearance
              </h3>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Chat UI Theme</h4>
                  <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm text-zinc-300 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none appearance-none cursor-pointer">
                    <option>Astrolabe Glass (Default)</option>
                    <option>Midnight Obsidian</option>
                    <option>VSCodium Native</option>
                  </select>
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Code Block Font Size</h4>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-500">Small</span>
                    <input type="range" min="10" max="18" defaultValue="13" className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-pink-500" />
                    <span className="text-xs text-zinc-500">Large</span>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-6 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Glassmorphic Micro-Animations</h4>
                    <p className="text-xs text-zinc-500 mt-1">Disable to save GPU resources on low-end machines.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Browser' && (
          <div className="space-y-6">
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                Agent Web Tools
              </h3>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Default Search Engine</h4>
                  <p className="text-xs text-zinc-500 mb-4">The engine the agent uses when performing internet research.</p>
                  <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm text-zinc-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none appearance-none cursor-pointer">
                    <option>Google Search (Recommended)</option>
                    <option>DuckDuckGo</option>
                    <option>Bing Search</option>
                  </select>
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Browser Automation Engine</h4>
                  <p className="text-xs text-zinc-500 mb-4">How the agent loads websites internally.</p>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 p-3 rounded-xl border border-orange-500/30 bg-orange-500/10 cursor-pointer">
                      <input type="radio" name="browser" defaultChecked className="w-4 h-4 text-orange-500 bg-zinc-900 border-white/20 focus:ring-orange-500 focus:ring-2" />
                      <div>
                        <span className="block text-sm font-bold text-orange-400">Headless Chrome (Native)</span>
                        <span className="block text-xs text-zinc-400">Fast, invisible background execution.</span>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-zinc-950 hover:border-white/20 transition-colors cursor-pointer">
                      <input type="radio" name="browser" className="w-4 h-4 text-orange-500 bg-zinc-900 border-white/20 focus:ring-orange-500 focus:ring-2" />
                      <div>
                        <span className="block text-sm font-bold text-zinc-300">System Webview</span>
                        <span className="block text-xs text-zinc-500">Opens a visible window. Best for debugging.</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'Local Engine' && (
          <div className="space-y-6">
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/10 blur-3xl rounded-full"></div>
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center justify-between relative z-10">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
                  System Inference Daemon
                </span>
                <span className={`text-[10px] px-2 py-1 rounded-md border ${daemonRunning ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-zinc-500 bg-zinc-800 border-zinc-700'}`}>
                  {daemonRunning ? 'RUNNING ON PORT 47990' : 'OFFLINE'}
                </span>
              </h3>
              
              <div className="space-y-6 relative z-10">
                <div>
                  <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                    The Astrolabe Local Daemon allows you to run models directly on your hardware (CPU/Vulkan/CUDA). 
                    It operates in the background outside of the VS Code Node.js environment to maximize throughput.
                  </p>
                  
                  <div className="flex gap-4">
                    {!daemonRunning ? (
                      <button 
                        onClick={() => vscodeApi?.postMessage({ command: 'startDaemon' })}
                        className="px-6 py-2.5 rounded-lg text-sm font-bold text-white bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-900/20 transition-colors"
                      >
                        Start Inference Engine
                      </button>
                    ) : (
                      <button 
                        onClick={() => vscodeApi?.postMessage({ command: 'stopDaemon' })}
                        className="px-6 py-2.5 rounded-lg text-sm font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                      >
                        Stop Engine
                      </button>
                    )}
                  </div>
                </div>

                {daemonRunning && daemonHealth?.hardware && (
                  <div className="border-t border-white/5 pt-6">
                    <h4 className="text-sm font-bold text-zinc-300 mb-4">Detected Hardware</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-zinc-950 border border-white/5 p-3 rounded-xl">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">CPU</p>
                        <p className="text-sm text-zinc-200">{daemonHealth.hardware.cpu}</p>
                      </div>
                      <div className="bg-zinc-950 border border-white/5 p-3 rounded-xl">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Memory</p>
                        <p className="text-sm text-zinc-200">{daemonHealth.hardware.memory_gb.toFixed(1)} GB</p>
                      </div>
                      <div className="bg-zinc-950 border border-white/5 p-3 rounded-xl col-span-2">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">GPU / Accelerator</p>
                        <p className="text-sm text-emerald-400 font-medium">{daemonHealth.hardware.gpu}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t border-white/5 pt-6">
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">High-Performance CUDA Backend (SGLang)</h4>
                  <p className="text-xs text-zinc-500 mb-4">
                    For users with NVIDIA GPUs, we recommend using SGLang instead of llama.cpp for extreme inference speeds.
                  </p>
                  <button 
                    onClick={() => vscodeApi?.postMessage({ command: 'installSGLang' })}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    Install SGLang Pipeline (Requires Python)
                  </button>
                </div>
              </div>
            </div>

            {/* Directory Config */}
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl relative">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-4">Models Directory</h3>
              <p className="text-xs text-zinc-400 mb-4">The absolute path where the Daemon downloads and reads GGUF models. Restart Daemon after changing.</p>
              <div className="flex gap-3">
                <input 
                  type="text" 
                  value={localModelsDir}
                  onChange={(e) => setLocalModelsDir(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
                  placeholder="e.g. ~/.exovon/models or C:\Models"
                />
                <button 
                  onClick={() => vscodeApi?.postMessage({ command: 'browseLocalModelsDirectory' })}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors"
                >
                  Browse...
                </button>
                <button 
                  onClick={() => vscodeApi?.postMessage({ command: 'setLocalModelsDirectory', directory: localModelsDir })}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-zinc-700 hover:bg-zinc-600 transition-colors"
                >
                  Save Path
                </button>
                <button 
                  onClick={() => {
                    setLocalModelsDir('~/.exovon/models');
                    vscodeApi?.postMessage({ command: 'setLocalModelsDirectory', directory: '~/.exovon/models' });
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* HF Browser */}
            <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl relative">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white tracking-widest uppercase flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  Hugging Face Downloader
                </h3>
                <button 
                  onClick={() => openModelHubWithQuery(hfSearchQuery)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 flex items-center gap-1.5 transition-colors"
                >
                  <span>✨</span>
                  <span>Open Model Hub</span>
                </button>
              </div>
              <div className="flex gap-3 mb-6">
                <input 
                  type="text" 
                  value={hfSearchQuery}
                  onChange={(e) => setHfSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && hfSearchQuery.trim()) {
                      setIsSearchingHf(true);
                      setHfSearchPage(0);
                      vscodeApi?.postMessage({ command: 'searchHuggingFace', query: hfSearchQuery, page: 0 });
                    }
                  }}
                  className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all placeholder:text-zinc-600"
                  placeholder="Search GGUF models (e.g. Llama-3, Qwen)..."
                />
                <button 
                  disabled={!hfSearchQuery.trim() || isSearchingHf || !daemonRunning}
                  onClick={() => {
                    setIsSearchingHf(true);
                    setHfSearchPage(0);
                    vscodeApi?.postMessage({ command: 'searchHuggingFace', query: hfSearchQuery, page: 0 });
                  }}
                  className="px-6 py-2 rounded-lg text-sm font-bold text-zinc-900 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSearchingHf && hfSearchPage === 0 ? 'Searching...' : 'Search'}
                </button>
              </div>

              {hfSearchResults.length > 0 && (
                <div className="space-y-3 mt-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {hfSearchResults.map((res: HfSearchResult) => (
                    <div key={res.id} className="bg-zinc-950 border border-white/5 p-4 rounded-xl flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-zinc-200">{res.id}</h4>
                        <p className="text-xs text-zinc-500 mt-1">{res.downloads?.toLocaleString() || 0} downloads</p>
                      </div>
                      <button 
                        onClick={() => {
                          setIsModelHubOpen(true);
                          fetchModelDetails(res.id);
                        }}
                        className="px-3 py-1.5 rounded-lg text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 transition-colors flex items-center gap-1.5 border border-sky-500/20 text-xs font-semibold"
                        title="Explore in Model Hub"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        <span>View in Hub</span>
                      </button>
                    </div>
                  ))}

                  {hasMoreHfResults && (
                    <button
                      onClick={() => {
                        const nextPage = hfSearchPage + 1;
                        setHfSearchPage(nextPage);
                        setIsSearchingHf(true);
                        vscodeApi?.postMessage({ command: 'searchHuggingFace', query: hfSearchQuery, page: nextPage });
                      }}
                      disabled={isSearchingHf}
                      className="w-full mt-4 py-3 rounded-lg text-sm font-bold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors border border-white/5 shadow-sm"
                    >
                      {isSearchingHf && hfSearchPage > 0 ? 'Loading...' : 'Load More Results'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Active Downloads List */}
            {activeDownloads.length > 0 && (
              <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl relative">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white tracking-widest uppercase flex items-center gap-2">
                    <svg className="w-4 h-4 text-sky-500 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Active Downloads
                  </h3>
                </div>
                <div className="space-y-4">
                  {activeDownloads.map((dl, i) => {
                    const { speed, eta } = getSpeedAndEta(dl);

                    return (
                      <div key={i} className="bg-zinc-950 border border-white/5 p-4 rounded-xl flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <h4 className="text-sm font-semibold text-zinc-200 truncate pr-4">{dl.model_name}</h4>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {speed && (
                              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center gap-1">
                                <svg className="w-3 h-3 text-sky-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                {speed}
                              </span>
                            )}
                            {eta && (
                              <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-white/5">
                                ETA {eta}
                              </span>
                            )}
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${dl.status === 'downloading' || dl.status === 'starting' ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : dl.status === 'finished' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                              {dl.status}
                            </span>
                          </div>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-1.5 rounded-full transition-all duration-500 ${dl.status === 'finished' ? 'bg-emerald-500' : dl.status.includes('error') ? 'bg-red-500' : 'bg-sky-500'}`} style={{ width: `${dl.percent}%` }}></div>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-zinc-400 font-mono">
                          <span className="text-zinc-300 font-medium">{dl.percent.toFixed(1)}%</span>
                          <div className="flex items-center gap-3">
                            {speed && <span className="text-sky-400 font-medium">{speed}</span>}
                            <span>{((dl.downloaded_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB / {((dl.total_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Local Models Table: "My Models" */}
            <div className="bg-[#141416] rounded-xl border border-white/5 shadow-2xl overflow-hidden relative">
              {/* Header Bar */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-[#18181b]/50">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-bold text-zinc-100 tracking-wide">
                    My Models
                  </h3>
                  <span className="text-xs text-zinc-500 font-mono px-2 py-0.5 bg-white/5 rounded">
                    {localModels.filter((m: LocalModel) => {
                      if (!modelFilterQuery.trim()) return true;
                      const q = modelFilterQuery.toLowerCase();
                      const raw = (m.id || '').toLowerCase();
                      const name = (m.name || '').toLowerCase();
                      const arch = (m.architecture || '').toLowerCase();
                      const quant = (m.quantization || '').toLowerCase();
                      return raw.includes(q) || name.includes(q) || arch.includes(q) || quant.includes(q);
                    }).length}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input 
                      ref={filterInputRef}
                      type="text"
                      value={modelFilterQuery}
                      onChange={(e) => setModelFilterQuery(e.target.value)}
                      placeholder="Filter models... (Ctrl + F)"
                      className="bg-zinc-950 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 w-64 transition-all"
                    />
                    {modelFilterQuery && (
                      <button 
                        onClick={() => setModelFilterQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <button 
                    onClick={() => vscodeApi?.postMessage({ command: 'getLocalModels' })}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                    title="Refresh Models List"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </div>
              </div>

              {/* Table View */}
              {localModels.length === 0 ? (
                <div className="text-center py-12 border-dashed border-white/5 rounded-xl m-4">
                  <p className="text-xs text-zinc-500">No models found in {localModelsDir}.</p>
                </div>
              ) : localModels.filter((m: LocalModel) => {
                if (!modelFilterQuery.trim()) return true;
                const q = modelFilterQuery.toLowerCase();
                const raw = (m.id || '').toLowerCase();
                const name = (m.name || '').toLowerCase();
                const arch = (m.architecture || '').toLowerCase();
                const quant = (m.quantization || '').toLowerCase();
                return raw.includes(q) || name.includes(q) || arch.includes(q) || quant.includes(q);
              }).length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-xs">
                  No models match "{modelFilterQuery}".
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-[11px] font-semibold text-zinc-400 bg-[#121214]">
                        <th className="py-2.5 px-4 font-medium">Name</th>
                        <th className="py-2.5 px-3 font-medium">Params</th>
                        <th className="py-2.5 px-3 font-medium">Publisher</th>
                        <th className="py-2.5 px-3 font-medium text-center">Quant</th>
                        <th className="py-2.5 px-3 font-medium">Size</th>
                        <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03] text-xs">
                      {localModels.filter((m: LocalModel) => {
                        if (!modelFilterQuery.trim()) return true;
                        const q = modelFilterQuery.toLowerCase();
                        const raw = (m.id || '').toLowerCase();
                        const name = (m.name || '').toLowerCase();
                        const arch = (m.architecture || '').toLowerCase();
                        const quant = (m.quantization || '').toLowerCase();
                        return raw.includes(q) || name.includes(q) || arch.includes(q) || quant.includes(q);
                      }).map((m: LocalModel) => {
                        const meta = extractModelMetadata(m.id, m);
                        const isRowActive = activeLocalModel === m.id || m.loaded;
                        const isLoadingThis = loadingModelId === m.id;

                        return (
                          <tr 
                            key={m.id}
                            className={`transition-colors duration-150 group relative ${
                              isRowActive 
                                ? 'bg-[#221f3f] text-zinc-100' 
                                : 'hover:bg-white/[0.02] text-zinc-300'
                            }`}
                          >
                            {/* 1. Name Column */}
                            <td className="py-3 px-4 max-w-[340px]">
                              <div className="flex items-center gap-2">
                                {isRowActive && (
                                  <span className="flex h-2 w-2 relative flex-shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span 
                                      className={`font-semibold text-xs truncate ${isRowActive ? 'text-indigo-200' : 'text-zinc-100'}`}
                                      title={m.id}
                                    >
                                      {m.name || formatModelDisplayName(m.id)}
                                    </span>
                                    {meta.isVision && (
                                      <span className="px-1 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[9px] font-mono shrink-0" title="Vision Multimodal">
                                        VL
                                      </span>
                                    )}
                                    {meta.isReasoning && (
                                      <span className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[9px] font-mono shrink-0" title="Reasoning / Thinking">
                                        Think
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-zinc-500 font-mono truncate" title={m.id}>
                                    {m.id}
                                  </div>
                                </div>
                              </div>
                              {isLoadingThis && (
                                <div className="mt-1.5 space-y-1">
                                  <div className="flex justify-between text-[10px] text-sky-400 font-mono">
                                    <span>{loadStatusMessage || 'Loading model...'}</span>
                                    <span>{loadProgressPercent}%</span>
                                  </div>
                                  <div className="w-full bg-zinc-900 rounded-full h-1 overflow-hidden">
                                    <div 
                                      className="bg-sky-400 h-1 rounded-full transition-all duration-300"
                                      style={{ width: `${Math.max(5, loadProgressPercent)}%` }}
                                    ></div>
                                  </div>
                                </div>
                              )}
                            </td>

                            {/* 2. Params Column */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              {meta.params ? (
                                <span className="inline-block px-2 py-0.5 rounded-full border border-indigo-400/20 bg-indigo-500/10 text-indigo-300 text-[11px] font-mono">
                                  {meta.params}
                                </span>
                              ) : (
                                <span className="text-zinc-600 font-mono text-[11px]">-</span>
                              )}
                            </td>

                            {/* 3. Publisher Column */}
                            <td className="py-3 px-3 whitespace-nowrap text-zinc-400 text-xs">
                              {meta.publisher}
                            </td>

                            {/* 4. Quant Column */}
                            <td className="py-3 px-3 whitespace-nowrap text-center">
                              <span className="inline-block px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-zinc-300 text-[11px] font-mono">
                                {meta.quant}
                              </span>
                            </td>

                            {/* 6. Size Column */}
                            <td className="py-3 px-3 whitespace-nowrap font-mono text-zinc-400 text-xs">
                              {m.size_display || (m.size_bytes ? `${(m.size_bytes / (1024*1024*1024)).toFixed(1)} GB` : '-')}
                            </td>

                            {/* 7. Actions Column (Load / Set Active / ⋯ menu) */}
                            <td className="py-3 px-4 text-right whitespace-nowrap relative min-w-[120px]">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {/* Inline Quick Trigger: Load or Active Indicator */}
                                {isLoadingThis ? (
                                  <span className="text-[10px] font-mono text-sky-400 animate-pulse">
                                    {loadProgressPercent}%
                                  </span>
                                ) : m.loaded ? (
                                  <button 
                                    onClick={() => vscodeApi?.postMessage({ command: 'setLocalLlmModelName', model: m.id })}
                                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                      activeLocalModel === m.id 
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                    }`}
                                  >
                                    {activeLocalModel === m.id ? 'Active' : 'Set Active'}
                                  </button>
                                ) : (
                                  <button 
                                    onClick={() => {
                                      setSelectedModelToLoad(m.id);
                                      if (daemonHealth?.hardware?.gpu?.toLowerCase().includes('nvidia')) {
                                        setLoadBackend('sglang');
                                      } else {
                                        setLoadBackend('llama.cpp');
                                      }
                                      setLoadModelModalOpen(true);
                                    }}
                                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                                  >
                                    Load
                                  </button>
                                )}

                                {/* Clean ⋯ Dropdown Menu Button */}
                                <div className="relative inline-block text-left">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveActionMenuId(activeActionMenuId === m.id ? null : m.id);
                                    }}
                                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
                                    title="Model Actions"
                                  >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                      <circle cx="12" cy="12" r="2" />
                                      <circle cx="19" cy="12" r="2" />
                                      <circle cx="5" cy="12" r="2" />
                                    </svg>
                                  </button>

                                  {/* Dropdown Popup */}
                                  {activeActionMenuId === m.id && (
                                    <div 
                                      className="absolute right-0 top-full mt-1 w-48 bg-[#1a1d26] border border-white/10 rounded-xl shadow-2xl py-1.5 z-50 text-xs text-zinc-200 backdrop-blur-md"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {m.loaded ? (
                                        <>
                                          <button 
                                            onClick={() => {
                                              vscodeApi?.postMessage({ command: 'clearKvCache' });
                                              setActiveActionMenuId(null);
                                            }}
                                            className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-purple-300"
                                          >
                                            <span>🧹</span> Clear KV Cache
                                          </button>
                                          <button 
                                            onClick={() => {
                                              vscodeApi?.postMessage({ command: 'unloadLocalModel' });
                                              setActiveActionMenuId(null);
                                            }}
                                            className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-amber-400"
                                          >
                                            <span>⏏️</span> Unload Model
                                          </button>
                                        </>
                                      ) : (
                                        <button 
                                          onClick={() => {
                                            setSelectedModelToLoad(m.id);
                                            if (daemonHealth?.hardware?.gpu?.toLowerCase().includes('nvidia')) {
                                              setLoadBackend('sglang');
                                            } else {
                                              setLoadBackend('llama.cpp');
                                            }
                                            setLoadModelModalOpen(true);
                                            setActiveActionMenuId(null);
                                          }}
                                          className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-sky-400"
                                        >
                                          <span>⚡</span> Load in Memory
                                        </button>
                                      )}

                                      <button 
                                        onClick={() => {
                                          vscodeApi?.postMessage({ command: 'setLocalLlmModelName', model: m.id });
                                          setActiveActionMenuId(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-zinc-300"
                                      >
                                        <span>🎯</span> Set as Active Model
                                      </button>

                                      <div className="my-1 border-t border-white/5"></div>

                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(m.id);
                                          setActiveActionMenuId(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-zinc-400"
                                      >
                                        <span>📋</span> Copy Model ID / Path
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Live Hugging Face Model Explorer Sub-Window Modal */}
      {isModelHubOpen && (() => {
        const selectedQuant = availableQuants[selectedQuantIndex] || availableQuants[0];
        const isDownloaded = selectedQuant && localModels.some(m => m.id.toLowerCase().includes(selectedQuant.filename.toLowerCase()));
        const activeDownloadItem = selectedQuant && activeDownloads.find(d => d.model_name.toLowerCase().includes(selectedQuant.filename.toLowerCase()));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="bg-[#18181b] border border-white/10 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex overflow-hidden text-zinc-200 animate-in zoom-in-95 duration-150">
              
              {/* Left Column: Search & Live Model List */}
              <div className="w-[360px] border-r border-white/10 flex flex-col bg-[#141416]">
                {/* Search Bar */}
                <div className="p-3.5 border-b border-white/5 space-y-2.5">
                  <div className="relative">
                    <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input 
                      type="text"
                      placeholder="Search Hugging Face models..."
                      value={hubSearchQuery}
                      onChange={(e) => {
                        const val = e.target.value;
                        setHubSearchQuery(val);
                        fetchLiveModels(hubSortMode, val);
                      }}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
                    />
                  </div>

                  {/* Filter / Sort Tabs */}
                  <div className="flex items-center gap-1 bg-zinc-900/60 p-1 rounded-lg border border-white/5 text-xs">
                    <button 
                      onClick={() => {
                        setHubSortMode('lastModified');
                        fetchLiveModels('lastModified', hubSearchQuery);
                      }}
                      className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium text-center transition-colors ${hubSortMode === 'lastModified' ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      Recent
                    </button>
                    <button 
                      onClick={() => {
                        setHubSortMode('trendingScore');
                        fetchLiveModels('trendingScore', hubSearchQuery);
                      }}
                      className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium text-center transition-colors ${hubSortMode === 'trendingScore' ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      Trending
                    </button>
                    <button 
                      onClick={() => {
                        setHubSortMode('downloads');
                        fetchLiveModels('downloads', hubSearchQuery);
                      }}
                      className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium text-center transition-colors ${hubSortMode === 'downloads' ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      Downloads
                    </button>
                  </div>
                </div>

                {/* Live Model Cards List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5 space-y-1.5">
                  {isLoadingModelsList ? (
                    <div className="flex flex-col items-center justify-center py-16 text-zinc-500 text-xs space-y-2">
                      <svg className="animate-spin w-5 h-5 text-zinc-400" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Fetching Hugging Face models...</span>
                    </div>
                  ) : liveModelsList.length === 0 ? (
                    <div className="text-center py-16 text-zinc-500 text-xs">
                      No models found.
                    </div>
                  ) : (
                    liveModelsList.map((m) => {
                      const isSelected = selectedHubModelId === m.id;
                      const parts = m.id.split('/');
                      const author = parts.length > 1 ? parts[0] : '';
                      const modelName = parts.length > 1 ? parts[1] : m.id;

                      return (
                        <div 
                          key={m.id}
                          onClick={() => fetchModelDetails(m.id)}
                          className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-start gap-2.5 ${
                            isSelected 
                              ? 'bg-zinc-800/90 border-zinc-600 text-white shadow-sm ring-1 ring-white/10' 
                              : 'bg-zinc-900/40 border-white/5 hover:border-white/10 hover:bg-zinc-800/40 text-zinc-300'
                          }`}
                        >
                          {renderProviderLogo(m.id)}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                                {modelName}
                              </span>
                              <span className="text-[10px] text-zinc-500 flex-shrink-0 font-mono">
                                {formatRelativeTime(m.lastModified)}
                              </span>
                            </div>

                            {author && (
                              <p className="text-[10px] text-zinc-400 truncate mb-1.5 font-mono">
                                by {author}
                              </p>
                            )}

                            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                              <span>⬇ {(m.downloads || 0).toLocaleString()}</span>
                              <span>⭐ {m.likes || 0}</span>
                              {m.pipeline_tag && (
                                <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-white/5 ml-auto">
                                  {m.pipeline_tag}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Model Details & Download Panel */}
              <div className="flex-1 flex flex-col bg-[#18181b] overflow-y-auto custom-scrollbar">
                {isLoadingDetails ? (
                  <div className="flex flex-col items-center justify-center h-full py-24 text-zinc-500 text-xs space-y-3">
                    <svg className="animate-spin w-6 h-6 text-zinc-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Loading repository details and files...</span>
                  </div>
                ) : selectedModelDetails ? (
                  <>
                    {/* Header Bar */}
                    <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between sticky top-0 bg-[#18181b]/95 backdrop-blur-md z-10">
                      <div className="flex items-center gap-3 min-w-0">
                        {renderProviderLogo(selectedModelDetails.id)}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm font-bold text-white tracking-wide truncate">
                              {selectedModelDetails.id}
                            </h2>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(selectedModelDetails.id);
                                setCopiedRepoId(true);
                                setTimeout(() => setCopiedRepoId(false), 2000);
                              }}
                              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-white/10 text-[11px] transition-colors"
                              title="Copy Model ID"
                            >
                              {copiedRepoId ? '✓ Copied' : 'Copy ID'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <button 
                        onClick={() => setIsModelHubOpen(false)}
                        className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 rounded-lg transition-colors"
                        title="Close"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>

                    <div className="p-6 space-y-5">
                      {/* Metric Stats */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 font-mono">
                        <span className="flex items-center gap-1.5 bg-zinc-900 px-3 py-1 rounded-lg border border-white/5">
                          <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          <span>{(selectedModelDetails.downloads || 0).toLocaleString()} downloads</span>
                        </span>

                        <span className="flex items-center gap-1.5 bg-zinc-900 px-3 py-1 rounded-lg border border-white/5">
                          <span>⭐</span>
                          <span>{selectedModelDetails.likes || 0} likes</span>
                        </span>

                        <span className="text-zinc-500">
                          Updated {formatRelativeTime(selectedModelDetails.lastModified)}
                        </span>

                        {selectedModelDetails.pipeline_tag && (
                          <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-white/10 text-[11px] font-mono ml-auto">
                            {selectedModelDetails.pipeline_tag}
                          </span>
                        )}
                      </div>

                      {/* Specifications Grid */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-zinc-900/60 border border-white/5 rounded-lg p-3">
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Architecture</span>
                          <span className="text-xs font-mono font-medium text-zinc-200">
                            {selectedModelDetails.gguf?.architecture || 'GGUF / Llama'}
                          </span>
                        </div>

                        <div className="bg-zinc-900/60 border border-white/5 rounded-lg p-3">
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Context Length</span>
                          <span className="text-xs font-mono font-medium text-zinc-200">
                            {selectedModelDetails.gguf?.context_length ? `${selectedModelDetails.gguf.context_length.toLocaleString()} tokens` : '131,072 tokens'}
                          </span>
                        </div>

                        <div className="bg-zinc-900/60 border border-white/5 rounded-lg p-3">
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">License</span>
                          <span className="text-xs font-mono font-medium text-zinc-200 truncate block">
                            {selectedModelDetails.cardData?.license || 'Open Weights'}
                          </span>
                        </div>
                      </div>

                      {/* Download Options Box */}
                      <div className="bg-zinc-900/80 border border-white/10 rounded-xl p-4 space-y-3.5 shadow-lg">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            Download Quantization ({availableQuants.length} files found)
                          </h4>
                        </div>

                        {/* Quantization Dropdown Selector */}
                        <div className="space-y-3">
                          <div className="relative">
                            <select 
                              value={selectedQuantIndex}
                              onChange={(e) => setSelectedQuantIndex(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3.5 py-2 text-xs text-zinc-200 font-mono appearance-none focus:outline-none focus:border-zinc-500 cursor-pointer"
                            >
                              {availableQuants.map((q, idx) => (
                                <option key={idx} value={idx}>
                                  [{q.quant}] {q.filename} - {q.sizeDisplay}
                                </option>
                              ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 text-xs">
                              ⇅
                            </div>
                          </div>

                          {/* Hardware Check & Action */}
                          <div className="flex items-center justify-between pt-1">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-white/5">
                              <span>⚡</span> Estimated VRAM: ~{selectedQuant?.sizeDisplay || '4.5 GB'}
                            </span>

                            {isDownloaded ? (
                              <button 
                                disabled
                                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5"
                              >
                                <span>✓</span> Downloaded
                              </button>
                            ) : activeDownloadItem ? (
                              <button 
                                disabled
                                className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center gap-2 animate-pulse"
                              >
                                <span>⬇</span> Downloading {activeDownloadItem.percent.toFixed(1)}%
                              </button>
                            ) : (
                              <button 
                                onClick={() => {
                                  if (selectedQuant) {
                                    vscodeApi?.postMessage({ command: 'downloadLocalModel', url: selectedQuant.directUrl, filename: selectedQuant.filename });
                                    vscodeApi?.postMessage({ command: 'showNotification', message: `Started download for ${selectedQuant.filename}` });
                                  }
                                }}
                                className="px-5 py-2 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 shadow-md flex items-center gap-2 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                <span>Download {selectedQuant?.sizeDisplay || ''}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Real Live Rendered README Section */}
                      <div className="space-y-2 pt-2">
                        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                          <span>📄</span> Repository README
                        </h4>

                        <div className="bg-zinc-900/60 border border-white/5 rounded-xl p-6 text-xs text-zinc-300 max-h-[500px] overflow-y-auto custom-scrollbar">
                          {modelReadme ? (
                            <ReactMarkdown
                              rehypePlugins={[rehypeHighlight]}
                              components={{
                                h1: ({ children }) => <h1 className="text-base font-bold text-white mt-4 mb-2 pb-1.5 border-b border-white/10">{children}</h1>,
                                h2: ({ children }) => <h2 className="text-sm font-bold text-zinc-100 mt-4 mb-2 pb-1 border-b border-white/5">{children}</h2>,
                                h3: ({ children }) => <h3 className="text-xs font-semibold text-zinc-200 mt-3 mb-1.5">{children}</h3>,
                                h4: ({ children }) => <h4 className="text-xs font-semibold text-zinc-300 mt-2 mb-1">{children}</h4>,
                                p: ({ children }) => <p className="text-xs leading-relaxed mb-3 last:mb-0 text-zinc-300 font-sans">{children}</p>,
                                a: ({ href, children }) => (
                                  <a 
                                    href={href} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors break-all"
                                  >
                                    {children}
                                  </a>
                                ),
                                ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-xs text-zinc-300 pl-1">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-xs text-zinc-300 pl-1">{children}</ol>,
                                li: ({ children }) => <li className="text-xs leading-relaxed text-zinc-300">{children}</li>,
                                blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-sky-500/60 bg-zinc-950/60 py-2 px-3 rounded-r-md text-zinc-400 text-xs italic">{children}</blockquote>,
                                img: ({ src, alt }) => <img src={src} alt={alt || 'Image'} className="max-w-full rounded-lg border border-white/10 my-3 shadow-md object-contain" />,
                                table: ({ children }) => (
                                  <div className="my-3 overflow-x-auto rounded-lg border border-white/10 bg-zinc-950/80">
                                    <table className="w-full text-left text-xs border-collapse font-sans">{children}</table>
                                  </div>
                                ),
                                thead: ({ children }) => <thead className="bg-zinc-900 border-b border-white/10 text-zinc-200 font-semibold uppercase text-[10px]">{children}</thead>,
                                tbody: ({ children }) => <tbody className="divide-y divide-white/5 text-zinc-300">{children}</tbody>,
                                tr: ({ children }) => <tr className="hover:bg-white/5 transition-colors">{children}</tr>,
                                th: ({ children }) => <th className="px-3 py-2 font-medium border-r border-white/5 last:border-r-0">{children}</th>,
                                td: ({ children }) => <td className="px-3 py-2 text-zinc-300 border-r border-white/5 last:border-r-0">{children}</td>,
                                hr: () => <hr className="my-4 border-white/10" />,
                                code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  return !inline && match ? (
                                    <div className="relative group my-3 border border-white/10 rounded-lg overflow-hidden bg-zinc-950 shadow-md">
                                      <div className="flex items-center justify-between bg-zinc-900 border-b border-white/5 px-3 py-1.5 select-none">
                                        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">{match[1]}</span>
                                        <button
                                          onClick={(e) => {
                                            navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                                            const btn = e.currentTarget;
                                            btn.textContent = 'Copied!';
                                            setTimeout(() => btn.textContent = 'Copy', 2000);
                                          }}
                                          className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono transition-colors cursor-pointer"
                                        >
                                          Copy
                                        </button>
                                      </div>
                                      <div className="p-3 overflow-x-auto custom-scrollbar text-[11px] font-mono text-zinc-300 leading-normal">
                                        <code className={className} {...props}>
                                          {children}
                                        </code>
                                      </div>
                                    </div>
                                  ) : (
                                    <code className="bg-zinc-800/80 px-1.5 py-0.5 rounded border border-white/10 text-sky-300 font-mono text-[11px]" {...props}>
                                      {children}
                                    </code>
                                  );
                                }
                              }}
                            >
                              {modelReadme}
                            </ReactMarkdown>
                          ) : (
                            <span className="text-zinc-500 italic">No README content found for this repository.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
                    Select a model from the list to view details and available quantizations.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* LM Studio-Style Model Hardware Configuration Sub-Window */}
      {loadModelModalOpen && (() => {
        const modelObj = localModels.find(m => m.id === selectedModelToLoad);
        const displayName = modelObj?.name || formatModelDisplayName(selectedModelToLoad);
        
        // Extract Quantization tag
        const quant = modelObj?.quantization || (selectedModelToLoad.match(/(Q\d+_[A-Za-z0-9_]+|FP16|BF16|Q\d+_\d+|IQ\d+_[A-Za-z0-9_]+)/i)?.[1].toUpperCase() || 'Q4_K_M');
        
        // Extract Param Size tag
        const paramMatch = selectedModelToLoad.match(/(\d+(\.\d+)?B(-[A-Za-z0-9]+)?)/i);
        const paramSize = paramMatch ? paramMatch[1].toUpperCase() : '7B';
        
        // Size in GB
        let sizeGb = 4.5;
        if (modelObj?.size_display) {
          const parsed = parseFloat(modelObj.size_display);
          if (!isNaN(parsed)) {
            if (modelObj.size_display.includes('GB')) sizeGb = parsed;
            else if (modelObj.size_display.includes('MB')) sizeGb = parsed / 1024;
          }
        }
        
        // Dynamic Model Geometry from GGUF metadata
        const maxContextLength = modelObj?.max_context_length || (paramSize.includes('26B') || paramSize.includes('35B') ? 262144 : (paramSize.includes('3B') || paramSize.includes('7B') || paramSize.includes('8B') ? 131072 : 32768));
        const totalModelLayers = modelObj?.total_layers || (paramSize.includes('26B') ? 31 : (paramSize.includes('31B') || paramSize.includes('32B') ? 61 : (paramSize.includes('35B') ? 41 : (paramSize.includes('14B') ? 49 : (paramSize.includes('1B') ? 27 : 33)))));
        
        const currentGpuLayers = nGPULayers < 0 ? totalModelLayers : Math.min(totalModelLayers, nGPULayers);
        const offloadLayers = currentGpuLayers;
        const offloadRatio = totalModelLayers > 0 ? currentGpuLayers / totalModelLayers : 1;

        // Real-time Memory Physics & Flash Attention Footprint Savings Calculation
        const kvRatio = sizeGb > 12 ? 0.26 : (sizeGb > 6 ? 0.16 : 0.08); // GB per 1024 tokens of full standard KV cache
        const ctxK = ctxSize / 1024;
        
        // 1. Standard Attention (without Flash Attention)
        const stdKvGb = ctxK * kvRatio;
        // Standard attention quadratic activation scratch matrix: O(S^2)
        const stdScratchGb = Math.min(16, Math.max(0.35, ctxK * 0.12 + 0.000000045 * (ctxSize * ctxSize)));
        const stdTotalContextGb = (stdKvGb + stdScratchGb) * offloadRatio;
        
        // 2. Flash Attention (with Flash Attention enabled)
        // Flash Attention computes attention in tiled on-chip SRAM: O(1) activation memory (~30MB)
        const faKvGb = ctxK * kvRatio * 0.78; // Compact contiguous KV cache layout
        const faScratchGb = 0.03; // ~30 MB on-chip GPU SRAM tile buffer
        const faTotalContextGb = (faKvGb + faScratchGb) * offloadRatio;

        // 3. Realtime VRAM Saved
        const savedVramGb = Math.max(0.1, (stdTotalContextGb - faTotalContextGb)).toFixed(2);
        
        // 4. Final Estimated Footprint
        const weightsGpuGb = sizeGb * offloadRatio;
        const activeContextGpuGb = flashAttn ? faTotalContextGb : stdTotalContextGb;
        const estimatedGpuGb = (weightsGpuGb + activeContextGpuGb + 0.25).toFixed(2);
        const activeContextTotalGb = flashAttn ? (faKvGb + faScratchGb) : (stdKvGb + stdScratchGb);
        const estimatedTotalGb = (sizeGb + activeContextTotalGb + 0.45).toFixed(2);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-zinc-900/40">
                <div className="flex items-center gap-3 min-w-0">
                  <button 
                    onClick={() => setLoadModelModalOpen(false)}
                    className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                    title="Back"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <h3 className="text-base font-bold text-white truncate">{displayName}</h3>
                </div>
                <button 
                  onClick={() => setLoadModelModalOpen(false)}
                  className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              
              <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar flex-1">
                {/* Estimated Memory Usage Bar */}
                <div className="bg-zinc-900/90 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-200">Estimated Memory Usage</span>
                      {flashAttn ? (
                        <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          ⚡ -{savedVramGb} GB VRAM Saved via Flash Attn
                        </span>
                      ) : (
                        <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono font-semibold">
                          ⚠️ Standard Attn (+{savedVramGb} GB Overhead)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs">
                      <div className="bg-zinc-950/80 border border-white/5 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                        <span className="text-zinc-500 font-medium">GPU</span>
                        <span className={`font-bold ${parseFloat(estimatedGpuGb) > 15 ? 'text-amber-400' : 'text-zinc-200'}`}>{estimatedGpuGb} GB</span>
                      </div>
                      <div className="bg-zinc-950/80 border border-white/5 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                        <span className="text-zinc-500 font-medium">Total</span>
                        <span className="text-zinc-200 font-bold">{estimatedTotalGb} GB</span>
                      </div>
                    </div>
                  </div>

                  {/* Real-time Flash Attention Memory Breakdown Mini-Bar */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-[11px] font-mono">
                    <div className="bg-zinc-950/50 px-2.5 py-1.5 rounded-lg border border-white/5">
                      <div className="text-zinc-500 text-[10px]">Model Weights</div>
                      <div className="text-zinc-300 font-semibold">{weightsGpuGb.toFixed(2)} GB</div>
                    </div>
                    <div className="bg-zinc-950/50 px-2.5 py-1.5 rounded-lg border border-white/5">
                      <div className="text-zinc-500 text-[10px]">KV Cache ({Math.round(ctxSize / 1024)}k)</div>
                      <div className="text-zinc-300 font-semibold">
                        {(flashAttn ? faKvGb : stdKvGb).toFixed(2)} GB 
                        {flashAttn && <span className="text-emerald-400 text-[9px] ml-1">(-{((stdKvGb - faKvGb) * offloadRatio).toFixed(2)}G)</span>}
                      </div>
                    </div>
                    <div className="bg-zinc-950/50 px-2.5 py-1.5 rounded-lg border border-white/5">
                      <div className="text-zinc-500 text-[10px]">Attn Scratch Buffer</div>
                      <div className="text-zinc-300 font-semibold">
                        {flashAttn ? (
                          <span className="text-emerald-400 font-semibold">O(1) 30MB</span>
                        ) : (
                          <span className="text-amber-400 font-semibold">{stdScratchGb.toFixed(2)} GB</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Model File Chips */}
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Model file</label>
                  <div className="bg-zinc-950/60 border border-white/10 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200 truncate">{displayName}</span>
                    <span className="text-[10px] font-mono font-semibold bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-white/5">{quant}</span>
                    <span className="text-[10px] font-mono font-semibold bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-white/5">{paramSize}</span>
                    <span className="text-[10px] font-mono font-bold bg-sky-500/15 text-sky-400 px-2 py-0.5 rounded border border-sky-500/20">GGUF</span>
                  </div>
                </div>

                {/* Context Length */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">Context Length</span>
                      <span className="text-zinc-500 text-[10px]" title="Context buffer token capacity for prompts and memory">(?)</span>
                    </div>
                    <input 
                      type="number"
                      value={ctxSize}
                      onChange={(e) => setCtxSize(Math.max(1024, Math.min(maxContextLength, Number(e.target.value))))}
                      className="w-28 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                      step={1024}
                      min={1024}
                      max={maxContextLength}
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                    <span>Model natively supports up to <span className="text-sky-400 font-mono font-semibold">{maxContextLength.toLocaleString()}</span> tokens</span>
                    <span className="font-mono text-zinc-400">{Math.round(ctxSize / 1024)}K tokens</span>
                  </div>
                  <input 
                    type="range"
                    min={2048}
                    max={maxContextLength}
                    step={1024}
                    value={ctxSize}
                    onChange={(e) => setCtxSize(Number(e.target.value))}
                    className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  {/* Preset quick buttons */}
                  <div className="flex items-center gap-1.5 pt-1">
                    {[4096, 8192, 16384, 32768, 65536, 131072, maxContextLength]
                      .filter((val, idx, arr) => val <= maxContextLength && arr.indexOf(val) === idx)
                      .map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setCtxSize(preset)}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${ctxSize === preset ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200'}`}
                        >
                          {preset === maxContextLength ? `Max (${Math.round(preset / 1024)}K)` : `${Math.round(preset / 1024)}K`}
                        </button>
                      ))}
                  </div>
                </div>

                {/* Max Generation Output Tokens (Horizon) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">Max Generation Tokens (Output Limit)</span>
                      <span className="text-zinc-500 text-[10px]" title="Maximum output tokens the model can produce in a single response turn">(?)</span>
                    </div>
                    <input 
                      type="number"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Math.max(512, Math.min(ctxSize, Number(e.target.value))))}
                      className="w-28 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                      step={1024}
                      min={512}
                      max={ctxSize}
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                    <span>Upper generation horizon: <span className="text-sky-400 font-mono font-semibold">{maxTokens.toLocaleString()}</span> tokens</span>
                    <span className="font-mono text-zinc-400">{Math.round(maxTokens / 1024)}K max output</span>
                  </div>
                  <input 
                    type="range"
                    min={1024}
                    max={Math.min(65536, ctxSize)}
                    step={1024}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  {/* Preset quick buttons */}
                  <div className="flex items-center gap-1.5 pt-1">
                    {[2048, 4096, 8192, 16384, 32768, 65536]
                      .filter((val, idx, arr) => val <= ctxSize && arr.indexOf(val) === idx)
                      .map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setMaxTokens(preset)}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${maxTokens === preset ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200'}`}
                        >
                          {Math.round(preset / 1024)}K
                        </button>
                      ))}
                  </div>
                </div>

                {/* GPU Offload */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">GPU Offload</span>
                      <span className="text-zinc-500 text-[10px]" title="Number of transformer layers offloaded to GPU">(?)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input 
                        type="number"
                        value={nGPULayers < 0 ? totalModelLayers : nGPULayers}
                        onChange={(e) => setNGPULayers(Number(e.target.value))}
                        className="w-24 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                        min={0}
                        max={totalModelLayers}
                      />
                      <button
                        onClick={() => setNGPULayers(nGPULayers < 0 ? currentGpuLayers : -1)}
                        className={`text-[10px] font-mono px-2 py-1 rounded-md border transition-colors ${nGPULayers < 0 ? 'bg-sky-500/20 text-sky-300 border-sky-500/30' : 'bg-zinc-800 text-zinc-400 border-transparent hover:bg-zinc-700'}`}
                      >
                        All ({totalModelLayers})
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Offload layers to <span className="text-zinc-400 font-medium">AMD Radeon 760M (Vulkan)</span> ({offloadLayers}/{totalModelLayers} layers)
                  </div>
                  <input 
                    type="range"
                    min={0}
                    max={totalModelLayers}
                    value={offloadLayers}
                    onChange={(e) => setNGPULayers(Number(e.target.value))}
                    className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* CPU Thread Pool Size */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">CPU Thread Pool Size</span>
                      <span className="text-zinc-500 text-[10px]" title="Threads utilized for host CPU matrix ops and token generation">(?)</span>
                    </div>
                    <input 
                      type="number"
                      value={nThreads}
                      onChange={(e) => setNThreads(Math.max(1, Number(e.target.value)))}
                      className="w-24 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                      min={1}
                      max={16}
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Physical Zen 4 CPU cores for host execution (recommended: 4 or 6)
                  </div>
                  <input 
                    type="range"
                    min={1}
                    max={12}
                    value={nThreads}
                    onChange={(e) => setNThreads(Number(e.target.value))}
                    className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* Batch Sizes (Evaluation & Physical) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Evaluation Batch Size (n_batch) */}
                  <div className="space-y-1.5 bg-zinc-950/40 p-3.5 rounded-xl border border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-medium text-zinc-300">Evaluation Batch</span>
                        <span className="text-zinc-500 text-[10px]" title="Prompt parallel throughput chunk size (n_batch)">(?)</span>
                      </div>
                      <input 
                        type="number"
                        value={nBatch}
                        onChange={(e) => setNBatch(Math.max(128, Number(e.target.value)))}
                        className="w-16 bg-zinc-950 border border-white/10 rounded-lg px-2 py-0.5 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                        step={128}
                        min={128}
                        max={4096}
                      />
                    </div>
                    <input 
                      type="range"
                      min={256}
                      max={4096}
                      step={256}
                      value={nBatch}
                      onChange={(e) => setNBatch(Number(e.target.value))}
                      className="w-full accent-sky-500 bg-zinc-800 h-1 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Physical Batch Size (n_ubatch) */}
                  <div className="space-y-1.5 bg-zinc-950/40 p-3.5 rounded-xl border border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-medium text-zinc-300">Physical Batch</span>
                        <span className="text-zinc-500 text-[10px]" title="Micro-batch dispatch size for GPU queue (n_ubatch)">(?)</span>
                      </div>
                      <input 
                        type="number"
                        value={nUbatch}
                        onChange={(e) => setNUbatch(Math.max(64, Number(e.target.value)))}
                        className="w-16 bg-zinc-950 border border-white/10 rounded-lg px-2 py-0.5 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                        step={64}
                        min={64}
                        max={1024}
                      />
                    </div>
                    <input 
                      type="range"
                      min={128}
                      max={1024}
                      step={64}
                      value={nUbatch}
                      onChange={(e) => setNUbatch(Number(e.target.value))}
                      className="w-full accent-sky-500 bg-zinc-800 h-1 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                {/* Flash Attention Toggle */}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <div className="pr-3">
                    <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                      <span>⚡ Flash Attention (VRAM & Speed Optimization)</span>
                      <span className="text-[9px] bg-sky-500/15 text-sky-400 px-1.5 py-0.5 rounded font-mono font-medium border border-sky-500/20">Vulkan / CUDA</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">
                      {flashAttn 
                        ? "Calculates attention in tiled on-chip cache. Reduces KV cache memory footprint & boosts prompt processing speeds by 2-3x." 
                        : "Standard attention calculation."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFlashAttn(!flashAttn)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${flashAttn ? 'bg-sky-500' : 'bg-zinc-700'}`}
                    title="Toggle Flash Attention"
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${flashAttn ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                  </button>
                </div>

                {/* Direct GPU Memory Allocation Toggle */}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <div className="pr-3">
                    <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                      <span>Direct GPU Memory Allocation (no-mmap)</span>
                      <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-medium border border-emerald-500/20">iGPU / VRAM</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">
                      {directGpuMemory 
                        ? "Allocates explicit device memory buffer objects (visible in system GPU/VRAM manager like LM Studio)." 
                        : "Uses fast virtual memory mapping (mmap)."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDirectGpuMemory(!directGpuMemory)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${directGpuMemory ? 'bg-sky-500' : 'bg-zinc-700'}`}
                    title="Toggle Direct GPU Memory Allocation"
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${directGpuMemory ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                  </button>
                </div>
              </div>

              {/* Action Footer */}
              <div className="p-4 border-t border-white/5 bg-zinc-900/40 flex items-center justify-between gap-3">
                <button
                  onClick={() => setLoadModelModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setLoadingModelId(selectedModelToLoad);
                    setLoadProgressPercent(10);
                    setLoadStatusMessage('Allocating GPU memory buffers...');
                    vscodeApi?.postMessage({ 
                      command: 'loadLocalModel', 
                      modelId: selectedModelToLoad,
                      backendPreference: loadBackend,
                      ctxSize: ctxSize,
                      nGPULayers: nGPULayers,
                      nThreads: nThreads,
                      nBatch: nBatch,
                      nUbatch: nUbatch,
                      useMmap: !directGpuMemory,
                      flashAttn: flashAttn,
                      maxTokens: maxTokens
                    });
                    setLoadModelModalOpen(false);
                  }}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold bg-sky-500 text-white hover:bg-sky-400 transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] flex items-center gap-2"
                >
                  <span>Load Model into Memory</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
