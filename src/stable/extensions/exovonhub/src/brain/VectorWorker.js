"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const os_1 = __importDefault(require("os"));
// Polyfill for transformers in Node.js worker
global.self = global;
let pipeline = null;
let lastPingTime = Date.now();
let inferenceCount = 0;
const MEMORY_CEILING_MB = worker_threads_1.workerData?.memoryCeilingMb || Math.min(1024, (os_1.default.totalmem() / 1024 / 1024) * 0.05);
async function initialize() {
    try {
        const transformers = await import('@xenova/transformers');
        // Configure environment
        transformers.env.allowLocalModels = true;
        transformers.env.useBrowserCache = false;
        // Load the model
        pipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true
        });
        if (worker_threads_1.parentPort) {
            worker_threads_1.parentPort.postMessage({ type: 'ready' });
        }
    }
    catch (error) {
        if (worker_threads_1.parentPort) {
            worker_threads_1.parentPort.postMessage({ type: 'error', error: error.message });
        }
    }
}
// Dead-man's switch: exit if no ping received for 30 seconds
setInterval(() => {
    if (Date.now() - lastPingTime > 30000) {
        process.exit(0);
    }
}, 5000);
if (worker_threads_1.parentPort) {
    worker_threads_1.parentPort.on('message', async (message) => {
        if (message.type === 'ping') {
            lastPingTime = Date.now();
        }
        else if (message.type === 'embed') {
            try {
                if (!pipeline) {
                    throw new Error('Pipeline not initialized yet');
                }
                // Compute embedding
                const output = await pipeline(message.text, { pooling: 'mean', normalize: true });
                // The output is a tensor, we need the raw float32 array
                const embedding = Array.from(output.data);
                worker_threads_1.parentPort?.postMessage({
                    type: 'embed_result',
                    id: message.id,
                    embedding
                });
                inferenceCount++;
                if (inferenceCount % 100 === 0) {
                    const rssMb = process.memoryUsage().rss / 1024 / 1024;
                    if (rssMb > MEMORY_CEILING_MB) {
                        // Signal parent that we are exceeding memory and voluntarily dying
                        worker_threads_1.parentPort?.postMessage({ type: 'memory_exceeded', rssMb, ceiling: MEMORY_CEILING_MB });
                        setTimeout(() => process.exit(0), 100);
                    }
                }
            }
            catch (error) {
                worker_threads_1.parentPort?.postMessage({
                    type: 'embed_error',
                    id: message.id,
                    error: error.message
                });
            }
        }
    });
}
initialize();
//# sourceMappingURL=VectorWorker.js.map