import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import * as https from 'https';

export class LlamaEngine {
  private llama?: any;
  private model?: any;
  private context?: any;
  private LlamaCompletion?: any;
  private ready: boolean = false;
  private isDownloading: boolean = false;
  private generationLock: Promise<void> = Promise.resolve();

  private modelUrl = 'https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf';
  private modelFileName = 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf';

  constructor(private storageUri: vscode.Uri) {}

  public async initialize(): Promise<void> {
    try {
      const homedir = os.homedir();
      const config = vscode.workspace.getConfiguration('exovonhub');
      const customModelsDir = config.get<string>('localModelsDirectory')?.replace(/^~/, homedir);

      const searchDirs = [
        customModelsDir,
        path.join(homedir, '.exovon', 'models'),
        path.join(this.storageUri.fsPath, 'models')
      ].filter(Boolean) as string[];

      let modelPath = '';
      for (const dir of searchDirs) {
        const candidate = path.join(dir, this.modelFileName);
        if (fs.existsSync(candidate)) {
          modelPath = candidate;
          break;
        }
      }

      if (!modelPath) {
        const targetDir = customModelsDir || path.join(homedir, '.exovon', 'models');
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        modelPath = path.join(targetDir, this.modelFileName);
        await this.downloadModel(modelPath);
      }

      const logDir = path.dirname(modelPath);
      fs.appendFileSync(path.join(logDir, 'exovon agent.log'), 'Initializing exovon agent...\n');

      // Bypass Webpack transpilation to preserve native ESM dynamic import
      const nodeLlamaCpp = await new Function("return import('node-llama-cpp')")();
      const { getLlama, LlamaCompletion } = nodeLlamaCpp;
      this.LlamaCompletion = LlamaCompletion;
      this.llama = await getLlama();
      this.model = await this.llama.loadModel({
        modelPath: modelPath,
      });
      this.context = await this.model.createContext({
        contextSize: 2048,
        threads: 4 // Use 4 threads to prevent maxing out CPU
      });

      this.ready = true;
      fs.appendFileSync(path.join(logDir, 'exovon agent.log'), 'LlamaEngine initialized successfully\n');
      console.log('LlamaEngine initialized with Qwen2.5-Coder-0.5B');
    } catch (e) {
      console.error('Failed to initialize LlamaEngine', e);
      this.ready = false;
      throw e;
    }
  }

  private async downloadModel(modelPath: string): Promise<void> {
    if (this.isDownloading) return;
    this.isDownloading = true;

    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Downloading local exovon agent SLM (Qwen2.5-Coder-0.5B)",
      cancellable: false
    }, async (progress) => {
      return new Promise<void>((resolve, reject) => {
        try {
          const file = fs.createWriteStream(modelPath);
          const fetchWithRedirect = (url: string, hops = 0) => {
            if (hops > 10) return reject(new Error('Too many redirects'));
            https.get(url, (response) => {
              if ([301, 302, 307, 308].includes(response.statusCode || 200)) {
                if (!response.headers.location) return reject(new Error('Redirect with no location header'));
                const newUrl = new URL(response.headers.location, url).toString();
                fetchWithRedirect(newUrl, hops + 1);
              } else {
                this.pipeDownload(response, file, progress, resolve, reject, modelPath);
              }
            }).on('error', (err) => {
              fs.unlink(modelPath, () => reject(err));
            });
          };
          fetchWithRedirect(this.modelUrl);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private pipeDownload(response: any, file: fs.WriteStream, progress: any, resolve: any, reject: any, modelPath: string) {
    const len = parseInt(response.headers['content-length'] || '0', 10);
    let downloaded = 0;
    let lastPercent = 0;
    
    response.pipe(file);
    
    response.on('data', (chunk: any) => {
      downloaded += chunk.length;
      if (len > 0) {
        const percent = Math.floor((downloaded / len) * 100);
        if (percent > lastPercent) {
          progress.report({ increment: percent - lastPercent, message: `${percent}%` });
          lastPercent = percent;
        }
      }
    });

    file.on('finish', () => {
      file.close();
      this.isDownloading = false;
      resolve();
    });

    file.on('error', (err) => {
      fs.unlink(modelPath, () => {});
      this.isDownloading = false;
      reject(err);
    });
  }

  public isReady(): boolean {
    return this.ready && this.context !== undefined;
  }

  public async getFimCompletion(prefix: string, suffix: string, token: vscode.CancellationToken): Promise<string> {
    if (!this.ready || !this.context || !this.LlamaCompletion) return '';

    const abortController = new AbortController();
    const tokenListener = token.onCancellationRequested(() => {
      abortController.abort();
    });

    // Await the previous generation to fully finish and dispose its sequence
    await this.generationLock;

    if (token.isCancellationRequested) {
      tokenListener.dispose();
      return '';
    }

    let releaseLock!: () => void;
    this.generationLock = new Promise(resolve => releaseLock = resolve);

    try {
      const sequence = this.context.getSequence();
      const completion = new this.LlamaCompletion({
        contextSequence: sequence
      });
      
      try {
        const result = await completion.generateInfillCompletion(prefix, suffix, {
          temperature: 0.1,
          maxTokens: 100,
          signal: abortController.signal,
          stopOnAbortSignal: true
        });
        
        const modelsDir = path.join(this.storageUri.fsPath, 'models');
        fs.appendFileSync(path.join(modelsDir, 'exovon agent.log'), 'Completion returned: ' + result + '\n');
        
        return result;
      } finally {
        // Manually dispose sequence to prevent "No sequences left" leak on AbortError
        sequence.dispose();
      }
    } catch (e) {
      const modelsDir = path.join(this.storageUri.fsPath, 'models');
      fs.appendFileSync(path.join(modelsDir, 'exovon agent.log'), 'Inference error: ' + e + '\n');
      console.error('Inference error:', e);
      return '';
    } finally {
      tokenListener.dispose();
      releaseLock();
    }
  }
}
