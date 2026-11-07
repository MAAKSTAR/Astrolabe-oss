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

    // Normalize and auto-route keys by prefix
    const rawTinyKey = opts.tinyfishKey || (opts.tavilyKey?.startsWith('sk-tinyfish-') ? opts.tavilyKey : '') || (opts.firesearchKey?.startsWith('sk-tinyfish-') ? opts.firesearchKey : '');
    const rawTavKey = opts.tavilyKey && !opts.tavilyKey.startsWith('sk-tinyfish-') && !opts.tavilyKey.startsWith('fc-') ? opts.tavilyKey : '';
    const rawFireKey = opts.firesearchKey && !opts.firesearchKey.startsWith('sk-tinyfish-') ? opts.firesearchKey : (opts.tavilyKey?.startsWith('fc-') ? opts.tavilyKey : '');
    const rawExaKey = opts.exaKey;

    let provider = (opts.provider || 'tavily').toLowerCase();

    // If provider is set to tavily but user only configured a TinyFish key, auto-switch
    if (provider === 'tavily' && !rawTavKey && rawTinyKey) {
      provider = 'tinyfish';
    } else if (provider === 'tavily' && !rawTavKey && rawFireKey) {
      provider = 'firesearch';
    }

    if (provider === 'tinyfish') {
      if (!rawTinyKey) {
        return `Error: No TinyFish API key configured. Please set your TinyFish API Key (sk-tinyfish-...) in Settings > Browser.`;
      }
      return this.searchTinyfish(query, rawTinyKey);
    } else if (provider === 'firesearch' || provider === 'firecrawl') {
      if (!rawFireKey) {
        return `Error: No Firesearch API key configured. Please set your Firesearch API Key in Settings > Browser.`;
      }
      return this.searchFiresearch(query, rawFireKey);
    } else if (provider === 'tavily') {
      if (!rawTavKey) {
        if (rawTinyKey) return this.searchTinyfish(query, rawTinyKey);
        if (rawFireKey) return this.searchFiresearch(query, rawFireKey);
        return `Error: No Tavily API key configured. Please set your Tavily API Key in Settings > Browser, or switch to TinyFish or DuckDuckGo.`;
      }
      return this.searchTavily(query, rawTavKey);
    } else if (provider === 'exa') {
      if (!rawExaKey) {
        return `Error: No Exa API key configured. Please set your Exa API Key in Settings.`;
      }
      return this.searchExa(query, rawExaKey);
    } else if (provider === 'duckduckgo' || provider === 'free') {
      return this.searchDuckDuckGo(query);
    } else {
      // Fallback: check which key is available
      if (rawTinyKey) return this.searchTinyfish(query, rawTinyKey);
      if (rawTavKey) return this.searchTavily(query, rawTavKey);
      if (rawFireKey) return this.searchFiresearch(query, rawFireKey);
      if (rawExaKey) return this.searchExa(query, rawExaKey);
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
      const url = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': apiKey,
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        return `TinyFish API Error: ${response.status} - ${await response.text()}`;
      }

      const data: any = await response.json();
      const results = data.results || data.data || [];
      if (results.length === 0) return 'No TinyFish search results found.';

      let responseStr = 'TinyFish Search Results:\n';
      results.slice(0, 5).forEach((r: any) => {
        const title = r.title || 'Web Result';
        const url = r.url || '';
        const snippet = r.snippet || r.content || '';
        responseStr += `- ${title} (${url})\n  ${snippet}\n\n`;
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
