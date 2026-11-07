export interface SearchOptions {
  provider?: string;
  tavilyKey?: string;
  firesearchKey?: string;
  tinyfishKey?: string;
  exaKey?: string;
}

export class WebSearchTools {
  /**
   * Performs semantic web search using Tavily, Firesearch, TinyFish, Exa, or DuckDuckGo fallback.
   */
  public static async searchWeb(query: string, optionsOrTavilyKey?: SearchOptions | string, exaKey?: string): Promise<string> {
    let opts: SearchOptions = {};

    if (typeof optionsOrTavilyKey === 'string') {
      opts = { tavilyKey: optionsOrTavilyKey, exaKey };
    } else if (optionsOrTavilyKey) {
      opts = optionsOrTavilyKey;
    }

    const provider = (opts.provider || 'tavily').toLowerCase();

    if (provider === 'tavily') {
      if (!opts.tavilyKey) {
        return `Error: No Tavily API key configured. Please set your Tavily API Key in Settings > Browser > Agent Web Tools.`;
      }
      return this.searchTavily(query, opts.tavilyKey);
    } else if (provider === 'firesearch' || provider === 'firecrawl') {
      if (!opts.firesearchKey) {
        return `Error: No Firesearch API key configured. Please set your Firesearch API Key in Settings > Browser > Agent Web Tools.`;
      }
      return this.searchFiresearch(query, opts.firesearchKey);
    } else if (provider === 'tinyfish') {
      if (!opts.tinyfishKey) {
        return `Error: No TinyFish API key configured. Please set your TinyFish API Key in Settings > Browser > Agent Web Tools.`;
      }
      return this.searchTinyfish(query, opts.tinyfishKey);
    } else if (provider === 'exa') {
      if (!opts.exaKey) {
        return `Error: No Exa API key configured. Please set your Exa API Key in Settings.`;
      }
      return this.searchExa(query, opts.exaKey);
    } else if (provider === 'duckduckgo' || provider === 'free') {
      return this.searchDuckDuckGo(query);
    } else {
      // Fallback: check which key is available
      if (opts.tavilyKey) return this.searchTavily(query, opts.tavilyKey);
      if (opts.firesearchKey) return this.searchFiresearch(query, opts.firesearchKey);
      if (opts.tinyfishKey) return this.searchTinyfish(query, opts.tinyfishKey);
      if (opts.exaKey) return this.searchExa(query, opts.exaKey);
      return this.searchDuckDuckGo(query);
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
      return responseStr.trim() || 'No results found.';
    } catch (e: any) {
      return `Tavily Request Error: ${e.message}`;
    }
  }

  private static async searchFiresearch(query: string, apiKey: string): Promise<string> {
    try {
      const response = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          query: query,
          limit: 5
        })
      });

      if (!response.ok) {
        return `Firesearch API Error: ${response.status} - ${await response.text()}`;
      }

      const data: any = await response.json();
      const results = data.data || data.results || [];
      if (results.length === 0) return 'No Firesearch results found.';

      let responseStr = 'Firesearch Results:\n';
      results.forEach((r: any) => {
        const title = r.title || r.metadata?.title || 'Web Result';
        const url = r.url || r.metadata?.sourceURL || '';
        const snippet = r.markdown || r.description || r.content || '';
        responseStr += `- ${title} (${url})\n  ${snippet.slice(0, 400)}\n\n`;
      });
      return responseStr.trim();
    } catch (e: any) {
      return `Firesearch Request Error: ${e.message}`;
    }
  }

  private static async searchTinyfish(query: string, apiKey: string): Promise<string> {
    try {
      const response = await fetch('https://api.tinyfish.io/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          query: query,
          max_results: 5
        })
      });

      if (!response.ok) {
        return `TinyFish API Error: ${response.status} - ${await response.text()}`;
      }

      const data: any = await response.json();
      const results = data.results || data.data || [];
      if (results.length === 0) return 'No TinyFish results found.';

      let responseStr = 'TinyFish Results:\n';
      results.forEach((r: any) => {
        responseStr += `- ${r.title || 'Result'} (${r.url || ''})\n  ${r.snippet || r.content || ''}\n\n`;
      });
      return responseStr.trim();
    } catch (e: any) {
      return `TinyFish Request Error: ${e.message}`;
    }
  }

  private static async searchDuckDuckGo(query: string): Promise<string> {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await fetch(url);
      if (!response.ok) {
        return `DuckDuckGo Error: ${response.status}`;
      }
      const data: any = await response.json();
      let responseStr = '';
      if (data.AbstractText) {
        responseStr += `Abstract (${data.AbstractSource || 'DuckDuckGo'}): ${data.AbstractText}\nURL: ${data.AbstractURL}\n\n`;
      }
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        responseStr += `Related Information:\n`;
        data.RelatedTopics.slice(0, 5).forEach((t: any) => {
          if (t.Text && t.FirstURL) {
            responseStr += `- ${t.Text} (${t.FirstURL})\n`;
          }
        });
      }
      return responseStr.trim() || `No direct DuckDuckGo abstract found for "${query}". Consider configuring a Tavily or Firesearch API key in Settings > Browser.`;
    } catch (e: any) {
      return `DuckDuckGo Request Error: ${e.message}`;
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
