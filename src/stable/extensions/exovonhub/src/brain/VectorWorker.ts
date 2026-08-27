import { parentPort, workerData } from 'worker_threads';
import os from 'os';

// Polyfill for transformers in Node.js worker
(global as any).self = global;

let pipeline: any = null;
let lastPingTime = Date.now();
let inferenceCount = 0;

const MEMORY_CEILING_MB = workerData?.memoryCeilingMb || Math.min(1024, (os.totalmem() / 1024 / 1024) * 0.05);

async function initialize() {
  try {
    const transformers = await import('@xenova/transformers');
    // Configure environment
    transformers.env.allowLocalModels = true;
    transformers.env.useBrowserCache = false;
    
    // Explicitly constrain ONNX WASM to a single thread to prevent CPU cache thrashing
    // when multiple workers are spawned.
    transformers.env.backends.onnx.wasm.numThreads = 1;
    
    // Load the model
    pipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      progress_callback: (info: any) => {
        if (parentPort) {
          parentPort.postMessage({ type: 'progress', info });
        }
      }
    });
    
    if (parentPort) {
      parentPort.postMessage({ type: 'ready' });
    }
  } catch (error: any) {
    if (parentPort) {
      parentPort.postMessage({ type: 'error', error: error.message });
    }
  }
}

// Dead-man's switch: exit if no ping received for 30 seconds
setInterval(() => {
  if (Date.now() - lastPingTime > 30000) {
    process.exit(0);
  }
}, 5000);

if (parentPort) {
  parentPort.on('message', async (message: any) => {
    if (message.type === 'ping') {
      lastPingTime = Date.now();
    } else if (message.type === 'embed') {
      try {
        if (!pipeline) {
          throw new Error('Pipeline not initialized yet');
        }
        
        // Compute embedding
        const output = await pipeline(message.text, { pooling: 'mean', normalize: true });
        // The output is a tensor, we need the raw float32 array
        const embedding = Array.from(output.data);
        
        parentPort?.postMessage({
          type: 'embed_result',
          id: message.id,
          embedding
        });
        
        inferenceCount++;
        if (inferenceCount % 100 === 0) {
          const rssMb = process.memoryUsage().rss / 1024 / 1024;
          if (rssMb > MEMORY_CEILING_MB) {
            // Signal parent that we are exceeding memory and voluntarily dying
            parentPort?.postMessage({ type: 'memory_exceeded', rssMb, ceiling: MEMORY_CEILING_MB });
            setTimeout(() => process.exit(0), 100);
          }
        }
      } catch (error: any) {
        parentPort?.postMessage({
          type: 'embed_error',
          id: message.id,
          error: error.message
        });
      }
    }
  });
}

initialize();
