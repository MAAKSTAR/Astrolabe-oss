export class WebSearchTools {
  /**
   * Performs semantic web search using Tavily or Exa API.
   */
  public static async searchWeb(query: string, tavilyKey?: string, exaKey?: string): Promise<string> {
    if (tavilyKey) {
      return this.searchTavily(query, tavilyKey);
    } else if (exaKey) {
      return this.searchExa(query, exaKey);
    } else {
      return `Error: No semantic search API key configured. Please set 'exovonhub.tavilyApiKey' or 'exovonhub.exaApiKey' in settings to use the Web Search tool.`;
    }
  }

  private static async searchTavily(query: string, apiKey: string): Promise<string> {
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

      const data: any = await response.json();
      let responseStr = '';
      if (data.answer) {
        responseStr += `Answer: ${data.answer}\n\n`;
      }
      if (data.results && data.results.length > 0) {
        responseStr += `Sources:\n`;
        data.results.forEach((r: any) => {
          responseStr += `- ${r.title} (${r.url})\n  ${r.content}\n\n`;
        });
      }
      return responseStr || 'No results found.';
    } catch (e: any) {
      return `Request Error: ${e.message}`;
    }
  }

  private static async searchExa(query: string, apiKey: string): Promise<string> {
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

      const data: any = await response.json();
      let responseStr = '';
      if (data.results && data.results.length > 0) {
        responseStr += `Sources:\n`;
        data.results.forEach((r: any) => {
          responseStr += `- ${r.title} (${r.url})\n  ${r.text}\n\n`;
        });
      }
      return responseStr || 'No results found.';
    } catch (e: any) {
      return `Request Error: ${e.message}`;
    }
  }
}
