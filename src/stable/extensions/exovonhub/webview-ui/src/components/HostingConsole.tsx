import { useState } from 'react';

export interface Deployment {
  id: string;
  subdomain: string;
  url: string;
  status: 'active' | 'building' | 'failed';
  date: string;
  buildTime: string;
}

export function HostingConsole({ vscodeApi }: { vscodeApi: any }) {
  // Tab 2: Hosting Edge State
  const [subdomain, setSubdomain] = useState<string>('my-portal');
  const [buildConfigExpanded, setBuildConfigExpanded] = useState<boolean>(false);
  const [buildCommand, setBuildCommand] = useState<string>('npm run build');
  const [outputDir, setOutputDir] = useState<string>('dist');
  const [nodeVersion, setNodeVersion] = useState<string>('20.x');
  
  // Deployment Simulation State
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [showProgress, setShowProgress] = useState<boolean>(false);
  const [deployStep, setDeployStep] = useState<string>('');
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  const handleOpenUrl = (url: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'openUrl', url });
    } else {
      window.open(url, '_blank');
    }
  };

  const handleDeploy = () => {
    if (isDeploying) return;
    if (!subdomain.trim()) {
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'showNotification', message: 'Enter a subdomain prefix.', type: 'error' });
      }
      return;
    }

    setIsDeploying(true);
    setShowProgress(true);
    setDeployStep('Initializing container builder...');

    if (vscodeApi) {
      vscodeApi.postMessage({
        command: 'deployWebApp',
        subdomain: subdomain.trim(),
        buildCommand,
        outputDir,
        nodeVersion
      });
    } else {
      const steps = [
        { text: 'Compiling source assets...', delay: 1000 },
        { text: 'Uploading artifacts to CDN edge nodes...', delay: 2000 },
        { text: 'Configuring network DNS routers...', delay: 3000 },
        { text: 'Deployment initialized globally.', delay: 4000 }
      ];

      steps.forEach((step, idx) => {
        setTimeout(() => {
          setDeployStep(step.text);
          if (idx === steps.length - 1) {
            setTimeout(() => {
              setIsDeploying(false);
              setShowProgress(false);
              const generatedUrl = `https://${subdomain.trim()}.exovon.app`;
              setDeployments(prev => [
                {
                  id: 'dep-' + Date.now(),
                  subdomain: subdomain.trim(),
                  url: generatedUrl,
                  status: 'active',
                  date: new Date().toLocaleString(),
                  buildTime: '24.1s'
                },
                ...prev
              ]);
            }, 500);
          }
        }, step.delay);
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0 relative select-none">
      
      {/* COMING SOON OVERLAY SHIELD */}
      <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 border border-zinc-900 rounded-lg">
        <div className="bg-gradient-to-tr from-amber-500 to-yellow-400 text-zinc-950 font-bold text-[9px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider mb-2 shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse">
          Coming Soon
        </div>
        <h2 className="text-zinc-200 font-bold text-xs tracking-wide font-sans text-center">
          Edge CDR CDN Distribution
        </h2>
        <p className="text-zinc-500 text-[10px] font-mono text-center mt-1.5 leading-relaxed max-w-[220px]">
          Direct global-edge static distributions are being integrated into the Exovon Cloud Gateway.
        </p>
      </div>

      {/* CONFIGURATION & DEPLOY TRIGGER */}
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col gap-4 relative overflow-hidden shrink-0 opacity-40">
        
        {/* MINIMALIST LINEAR DEPLOYING LOADER */}
        {showProgress && (
          <div className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center z-20 p-6 transition-all duration-300">
            <div className="w-full max-w-[200px] h-[1px] bg-zinc-800 overflow-hidden relative mb-4 rounded-full">
              <div className="absolute top-0 bottom-0 left-0 w-1/2 bg-zinc-100 rounded-full animate-loader"></div>
            </div>
            <h3 className="text-xs font-bold font-mono tracking-wider text-zinc-200 uppercase">
              Uploading build payload
            </h3>
            <p className="text-[10px] text-zinc-500 font-mono mt-1 text-center truncate w-full">
              {deployStep}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px]">
          <label className="font-semibold uppercase tracking-wider text-zinc-400 font-mono">
            Edge Hosting Properties
          </label>
          <div className="text-zinc-500 font-mono">
            DNS: Connected
          </div>
        </div>

        {/* SUBDOMAIN INPUT */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono text-zinc-400">Subdomain Host Prefix</span>
          <div className="flex items-stretch rounded border border-zinc-800 bg-zinc-950 overflow-hidden">
            <input
              type="text"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="my-portal"
              className="flex-1 bg-transparent text-zinc-200 border-none outline-none px-3 py-1.5 text-xs font-mono"
            />
            <div className="bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] font-mono flex items-center px-3 select-none">
              .exovon.app
            </div>
          </div>
          <div className="text-[9px] text-zinc-500 font-mono mt-0.5 pl-0.5">
            Live target link: <span className="underline text-zinc-300 font-semibold">https://{subdomain || '...'}.exovon.app</span>
          </div>
        </div>

        {/* ACCORDION SETTINGS */}
        <div className="border border-zinc-800 rounded overflow-hidden">
          <button
            onClick={() => setBuildConfigExpanded(!buildConfigExpanded)}
            className="w-full flex items-center justify-between p-2.5 bg-zinc-950 hover:bg-zinc-900 text-[10px] font-mono text-zinc-400 font-bold transition-all duration-150"
          >
            <span>Build Configurations</span>
            <span className="text-zinc-600">{buildConfigExpanded ? '▲' : '▼'}</span>
          </button>

          {buildConfigExpanded && (
            <div className="p-3 bg-zinc-950 border-t border-zinc-850 flex flex-col gap-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-mono text-zinc-500">Build Command</span>
                  <input
                    type="text"
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-200 outline-none focus:border-zinc-700"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-mono text-zinc-500">Output Folder</span>
                  <input
                    type="text"
                    value={outputDir}
                    onChange={(e) => setOutputDir(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-200 outline-none focus:border-zinc-700"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-mono text-zinc-500">Node.js Version</span>
                <select
                  value={nodeVersion}
                  onChange={(e) => setNodeVersion(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[10px] font-mono text-zinc-200 outline-none focus:border-zinc-700"
                >
                  <option value="22.x">Node 22.x (Latest)</option>
                  <option value="20.x">Node 20.x (Recommended)</option>
                  <option value="18.x">Node 18.x</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* SOLID WHITE DEPLOY BUTTON */}
        <button
          onClick={handleDeploy}
          disabled={isDeploying}
          className={`w-full py-2.5 px-4 rounded font-bold font-mono text-xs tracking-wider uppercase transition-all duration-150 ${
            isDeploying
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-950 active:scale-[0.99]'
          }`}
        >
          Deploy Web Application
        </button>

      </div>

      {/* ACTIVE DEPLOYMENTS LIST CARD */}
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono px-1 shrink-0">
          <span>Active Containers ({deployments.length})</span>
          <span>Region: global-edge-1</span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 max-h-[180px] pr-1">
          {deployments.length === 0 ? (
            <div className="h-20 border border-zinc-800 rounded-lg flex items-center justify-center border-dashed">
              <p className="text-[10px] text-zinc-600 font-mono">No active edge deployments.</p>
            </div>
          ) : (
            deployments.map((dep) => (
              <div
                key={dep.id}
                className="p-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg flex flex-col gap-2.5 transition-all duration-150"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold font-mono text-zinc-200">
                    {dep.subdomain}.exovon.app
                  </span>
                  <span className="text-[9px] text-zinc-500 font-mono">
                    {dep.buildTime} build
                  </span>
                </div>

                <div className="grid grid-cols-2 text-[9px] text-zinc-500 font-mono border-t border-zinc-850 pt-2">
                  <div>Status: <span className="text-zinc-200 font-bold uppercase">Online</span></div>
                  <div className="text-right truncate">Created: {dep.date.split(',')[0]}</div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenUrl(dep.url)}
                    className="flex-1 py-1.5 px-2 bg-zinc-950 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 text-[10px] font-bold font-mono rounded transition-all duration-150"
                  >
                    Open Link
                  </button>
                  <button
                    onClick={() => {
                      setDeployments(prev => prev.filter(d => d.id !== dep.id));
                      if (vscodeApi) {
                        vscodeApi.postMessage({ command: 'showNotification', message: 'Deployment removed.', type: 'info' });
                      }
                    }}
                    className="py-1.5 px-3 bg-zinc-950 hover:bg-red-950/20 text-zinc-500 hover:text-red-400 border border-zinc-800 hover:border-red-900/30 text-[10px] font-bold font-mono rounded transition-all duration-150"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
