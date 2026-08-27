interface HubScreenProps {
  onInstallAgent: (agentId: string) => void;
}

export function HubScreen({ onInstallAgent }: HubScreenProps) {
  const mockAgents = [
    { id: 'agent-1', name: 'Code Reviewer', description: 'Automatically reviews PRs for common issues.' },
    { id: 'agent-2', name: 'UI Generator', description: 'Generates React components from descriptions.' },
    { id: 'agent-3', name: 'Refactor Bot', description: 'Suggests and applies code refactoring.' }
  ];

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6 text-zinc-100">Agents Hub</h2>
      <div className="grid grid-cols-1 gap-4">
        {mockAgents.map(agent => (
          <div key={agent.id} className="bg-zinc-800/50 border border-zinc-700 p-4 rounded-xl flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-200">{agent.name}</h3>
              <p className="text-sm text-zinc-400 mt-2">{agent.description}</p>
            </div>
            <button
              onClick={() => onInstallAgent(agent.id)}
              className="mt-4 bg-zinc-200 text-zinc-950 font-semibold py-2 px-4 rounded-lg hover:bg-zinc-100 transition-colors w-full sm:w-auto self-start"
            >
              Install
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
