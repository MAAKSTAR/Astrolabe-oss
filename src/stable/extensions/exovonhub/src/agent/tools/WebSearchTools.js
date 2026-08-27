"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSearchTools = void 0;
class WebSearchTools {
    /**
     * Performs semantic web search using Tavily or Exa API.
     */
    static async searchWeb(query, tavilyKey, exaKey) {
        if (tavilyKey) {
            return this.searchTavily(query, tavilyKey);
        }
        else if (exaKey) {
            return this.searchExa(query, exaKey);
        }
        else {
            return `Error: No semantic search API key configured. Please set 'exovonhub.tavilyApiKey' or 'exovonhub.exaApiKey' in settings to use the Web Search tool.`;
        }
    }
    static async searchTavily(query, apiKey) {
        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: apiKey,
                    query: query,
                    search_depth: "basic",
                    include_answer: true,
                    max_results: 5
                })
            });
            if (!response.ok) {
                return `Tavily API Error: ${response.status} - ${await response.text()}`;
            }
            const data = await response.json();
            let responseStr = '';
            if (data.answer) {
                responseStr += `Answer: ${data.answer}\n\n`;
            }
            if (data.results && data.results.length > 0) {
                responseStr += `Sources:\n`;
                data.results.forEach((r) => {
                    responseStr += `- ${r.title} (${r.url})\n  ${r.content}\n\n`;
                });
            }
            return responseStr || 'No results found.';
        }
        catch (e) {
            return `Request Error: ${e.message}`;
        }
    }
    static async searchExa(query, apiKey) {
        try {
            const response = await fetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey
                },
                body: JSON.stringify({
                    query: query,
                    numResults: 5,
                    contents: { text: { maxCharacters: 1000 } }
                })
            });
            if (!response.ok) {
                return `Exa API Error: ${response.status} - ${await response.text()}`;
            }
            const data = await response.json();
            let responseStr = '';
            if (data.results && data.results.length > 0) {
                responseStr += `Sources:\n`;
                data.results.forEach((r) => {
                    responseStr += `- ${r.title} (${r.url})\n  ${r.text}\n\n`;
                });
            }
            return responseStr || 'No results found.';
        }
        catch (e) {
            return `Request Error: ${e.message}`;
        }
    }
}
exports.WebSearchTools = WebSearchTools;
//# sourceMappingURL=WebSearchTools.js.map