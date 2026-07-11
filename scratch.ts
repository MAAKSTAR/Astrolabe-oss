import * as https from 'https';

async function* executeOpenAiStream(model: string, messages: any[], functionDeclarations: any[]) {
    let endpoint = 'integrate.api.nvidia.com';
    let pathStr = '/v1/chat/completions';
    let apiKey = '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';

    let payloadObj: any = {
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: messages,
      stream: true,
      max_tokens: 16384,
      chat_template_kwargs: { thinking: true, reasoning_effort: "high" }
    };

    const payload = JSON.stringify(payloadObj);

    const options = {
      hostname: endpoint,
      port: 443,
      path: pathStr,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const responseStream = await new Promise<any>((resolve, reject) => {
      const req = https.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errorData = '';
          res.on('data', chunk => errorData += chunk);
          res.on('end', () => reject(new Error(`API Error ${res.statusCode}: ${errorData}`)));
          return;
        }
        resolve(res);
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    let buffer = '';
    for await (const chunk of responseStream) {
      buffer += chunk.toString('utf8');
      let lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') return;
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices[0]?.delta;
            if (!delta) continue;

            const formattedChunk: any = { candidates: [{ content: { parts: [] } }] };
            if (delta.content) {
              formattedChunk.candidates[0].content.parts.push({ text: delta.content });
            }
            if (delta.reasoning_content || delta.reasoning) {
              const reasoning = delta.reasoning_content || delta.reasoning;
              formattedChunk.candidates[0].content.parts.push({ text: `<thought>${reasoning}</thought>` });
            }

            if (formattedChunk.candidates[0].content.parts.length > 0) {
              yield formattedChunk;
            }
          } catch (e) {}
        }
      }
    }
}

async function test() {
  const stream = executeOpenAiStream('test', [{role: 'user', content: 'can you explain me my workspace?'}], []);
  let streamingText = '';
  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          streamingText += part.text;
        }
      }
    }
  }
  console.log("FINAL TEXT LENGTH:", streamingText.length);
  console.log("FINAL TEXT SNIPPET:", streamingText.substring(0, 50));
}
test();
