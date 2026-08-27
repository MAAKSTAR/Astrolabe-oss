import * as vscode from 'vscode';

export function buildOpenAiPayload(model: string, openAiMessages: any[], openAiTools: any[] = []) {
  const config = vscode.workspace.getConfiguration('exovonhub');
  const userConfiguredMaxTokens = config.get<number>('localMaxTokens') || 16384;

  let payloadObj: any = {
    model: model,
    messages: openAiMessages,
    tools: openAiTools.length > 0 ? openAiTools : undefined,
    stream: true,
    max_tokens: userConfiguredMaxTokens
  };

  if (model.includes('gguf') || model.startsWith('local') || model.includes(':') || model.includes('llama') || model.includes('qwen') || model.includes('gemma') || model.includes('mythos') || model.includes('ornith') || model.includes('vibetanker') || model.includes('vibethinker')) {
    payloadObj.repeat_penalty = 1.15;
    payloadObj.frequency_penalty = 0.3;
    payloadObj.presence_penalty = 0.2;
    payloadObj.max_tokens = userConfiguredMaxTokens;
  }

  if (model === 'deepseek-v4-flash') {
    payloadObj.model = 'deepseek-ai/deepseek-v4-flash';
    payloadObj.max_tokens = 16384;
    payloadObj.chat_template_kwargs = { thinking: true, reasoning_effort: "high" };
  } else if (model === 'glm-5.2') {
    payloadObj.model = 'glm-5.2'; 
  } else if (model.startsWith('mimo-v2.5')) {
    payloadObj.model = model; 
  }

  return payloadObj;
}
