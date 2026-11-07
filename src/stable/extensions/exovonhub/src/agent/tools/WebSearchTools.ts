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

  /**
   * Fetches and extracts the readable markdown or text content of any web page URL.
   */
  public static async fetchWebPage(url: string, options?: SearchOptions): Promise<string> {
    try {
      if (!url || typeof url !== 'string') {
        return 'Error: URL parameter is required.';
      }

      const trimmedUrl = url.trim();
      if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
        return `Error: Invalid URL "${trimmedUrl}". URL must start with http:// or https://`;
      }

      // Check if Firecrawl / Firesearch key is available for deep markdown extraction
      const rawFireKey = options?.firesearchKey || (options?.tavilyKey?.startsWith('fc-') ? options.tavilyKey : '');
      if (rawFireKey) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000);
          const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${rawFireKey}`
            },
            body: JSON.stringify({ url: trimmedUrl, formats: ['markdown'] })
          });
          clearTimeout(timeoutId);

          if (scrapeRes.ok) {
            const scrapeData: any = await scrapeRes.json();
            const md = scrapeData.data?.markdown || scrapeData.markdown;
            if (md && typeof md === 'string' && md.trim().length > 0) {
              const cleanedMd = md.trim();
              if (cleanedMd.length > 16000) {
                return `${cleanedMd.slice(0, 16000)}\n\n[Content truncated to 16,000 characters for context efficiency...]`;
              }
              return cleanedMd;
            }
          }
        } catch {
          // Fall through to native HTTP fetch on timeout or error
        }
      }

      // Fast native HTTP fetch with HTML-to-clean-markdown parsing
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(trimmedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Astrolabe/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.5,*/*;q=0.3'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return `HTTP Error ${res.status} ${res.statusText} while fetching "${trimmedUrl}".`;
      }

      const contentType = res.headers.get('content-type') || '';
      const rawBody = await res.text();

      // If already JSON or plain text
      if (contentType.includes('application/json') || contentType.includes('text/plain')) {
        const text = rawBody.trim();
        if (text.length > 16000) {
          return `${text.slice(0, 16000)}\n\n[Content truncated to 16,000 characters...]`;
        }
        return text || 'Empty response.';
      }

      // Convert HTML into clean, human-readable Markdown
      const cleanMarkdown = this.htmlToCleanMarkdown(rawBody, trimmedUrl);
      if (!cleanMarkdown || cleanMarkdown.length < 20) {
        return `Fetched "${trimmedUrl}", but no readable text content could be extracted (page may require dynamic client-side rendering).`;
      }

      if (cleanMarkdown.length > 16000) {
        return `${cleanMarkdown.slice(0, 16000)}\n\n[Content truncated to 16,000 characters for context efficiency...]`;
      }

      return cleanMarkdown;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return `Timeout error: Web page took longer than 12 seconds to respond (${url}).`;
      }
      return `Failed to fetch web page (${url}): ${e.message}`;
    }
  }

  /**
   * Transforms raw HTML into clean, readable Markdown by stripping chrome, scripts, and converting blocks.
   */
  private static htmlToCleanMarkdown(html: string, pageUrl: string): string {
    let text = html || '';

    // 1. Remove non-content elements
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
               .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
               .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
               .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
               .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
               .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
               .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
               .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '');

    // 2. Extract title if present
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // 3. Headings & semantic structure
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
               .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
               .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
               .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n')
               .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n')
               .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n\n```\n$1\n```\n\n')
               .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, ' `$1` ')
               .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n* $1')
               .replace(/<br\s*[\/]?>/gi, '\n')
               .replace(/<hr\s*[\/]?>/gi, '\n---\n')
               .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '$1\n')
               .replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, ' | $1 ');

    // 4. Links: convert <a href="url">text</a> -> [text](url)
    text = text.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
      const cleanLinkText = linkText.replace(/<[^>]+>/g, '').trim();
      if (!cleanLinkText || href.startsWith('javascript:') || href.startsWith('#')) {
        return cleanLinkText;
      }
      return `[${cleanLinkText}](${href})`;
    });

    // 5. Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // 6. Decode common HTML entities
    text = text.replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&#x27;/g, "'")
               .replace(/&mdash;/g, '—')
               .replace(/&ndash;/g, '–')
               .replace(/&hellip;/g, '…');

    // 7. Clean up whitespace and line breaks
    text = text.replace(/[ \t]+/g, ' ')
               .replace(/\n\s*\n\s*\n+/g, '\n\n')
               .trim();

    if (title && !text.startsWith(`# ${title}`)) {
      text = `# ${title}\nSource: ${pageUrl}\n\n${text}`;
    }

    return text;
  }
}
