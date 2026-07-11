const fs = require('fs');

async function measurePayload() {
  const fsTools = fs.readFileSync('/home/maakstar/EXOVON_ECOSYSTEM/exovonhub/src/agent/tools/FileSystemTools.ts', 'utf8');
  const orchestrator = fs.readFileSync('/home/maakstar/EXOVON_ECOSYSTEM/exovonhub/src/agent/AgentOrchestrator.ts', 'utf8');
  
  console.log("=== EXOVON OVERHEAD SIMULATION ===");
  console.log(`FileSystemTools.ts raw size: ${fsTools.length} characters (~${Math.round(fsTools.length / 4)} tokens)`);
  
  const sysPromptMatch = orchestrator.match(/const systemInstruction = `([\s\S]*?)`;/);
  if (sysPromptMatch) {
    const sysPrompt = sysPromptMatch[1];
    console.log(`Base System Prompt size: ${sysPrompt.length} chars (~${Math.round(sysPrompt.length / 4)} tokens)`);
  }
}

measurePayload();
