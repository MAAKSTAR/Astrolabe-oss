import sys

with open('/home/maakstar/EXOVON_ECOSYSTEM/exovonhub/webview-ui/src/App.tsx', 'r') as f:
    lines = f.readlines()

start_line = -1
end_line = -1

for i, line in enumerate(lines):
    if '{isLoggedIn ? (' in line:
        start_line = i
    if '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />' in line:
        end_line = i + 2 # include the closing </svg> and </button>
        break

if start_line == -1 or end_line == -1:
    print("Could not find boundaries")
    sys.exit(1)

new_content = """          <button 
            onClick={() => setIsThreadsSidebarOpen(true)}
            className="flex items-center justify-center p-1 bg-zinc-900/60 border border-zinc-800/80 rounded-lg hover:bg-zinc-800/80 hover:text-zinc-200 text-zinc-400 transition-colors"
            title="Past Chats"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          
          <button 
            onClick={() => {
              if (vscodeApi) vscodeApi.postMessage({ command: 'openSettings' });
            }}
            className="flex items-center justify-center p-1 bg-zinc-900/60 border border-zinc-800/80 rounded-lg hover:bg-zinc-800/80 hover:text-zinc-200 text-zinc-400 transition-colors"
            title="Settings"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
"""

lines = lines[:start_line] + [new_content] + lines[end_line:]

with open('/home/maakstar/EXOVON_ECOSYSTEM/exovonhub/webview-ui/src/App.tsx', 'w') as f:
    f.writelines(lines)

print("Patched successfully")
