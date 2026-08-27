// =============================================================================
// Inference Engine Module
// =============================================================================
// Wraps llama-cpp-4 to load a .gguf model into VRAM/RAM and run inference.
// Produces tokens as a stream that the API layer converts to SSE events.
//
// This runs entirely in native C++/Rust memory — completely outside Node.js.
// GPU acceleration (Vulkan/CUDA/Metal) is handled by llama.cpp at compile time.
// =============================================================================

use std::num::NonZeroU32;
use std::sync::Arc;

use llama_cpp_4::prelude::*;
use llama_cpp_4::context::params::LlamaFlashAttnType;

/// The core inference engine that wraps llama.cpp.
/// This struct owns the loaded model and context, running entirely in native
/// C++/Rust memory space — completely outside of Node.js.
pub struct InferenceEngine {
    pub model_path: String,
    pub model_name: String,
    pub ctx_size: u32,
    pub n_threads: u32,
    pub n_batch: u32,
    pub n_ubatch: u32,
    pub flash_attn: bool,
    backend: Arc<LlamaBackend>,
    model: Arc<LlamaModel>,
}

// LlamaModel uses C++ pointers that are safe to share across threads.
// The llama.cpp library handles its own thread safety for model reads.
unsafe impl Send for InferenceEngine {}
unsafe impl Sync for InferenceEngine {}

/// Telemetry and speed metrics for prompt evaluation and token generation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InferenceMetrics {
    pub prompt_tokens: usize,
    pub prompt_time_ms: f64,
    pub prompt_tps: f64,
    pub completion_tokens: usize,
    pub completion_time_ms: f64,
    pub completion_tps: f64,
    pub total_time_ms: f64,
}

/// A single token chunk produced during streaming inference.
#[derive(Debug, Clone)]
pub struct TokenChunk {
    pub text: String,
    pub is_final: bool,
    pub prompt_tokens: Option<usize>,
    pub prompt_processed: Option<usize>,
    pub metrics: Option<InferenceMetrics>,
}

/// Configuration for loading a model.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub model_path: String,
    pub ctx_size: u32,
    pub n_gpu_layers: i32,  // -1 = offload all layers to GPU
    pub n_threads: u32,
    pub n_batch: u32,
    pub n_ubatch: u32,
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: i32,
    pub repeat_penalty: f32,
    pub use_mmap: bool,
    pub flash_attn: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            model_path: String::new(),
            ctx_size: 8192,
            n_gpu_layers: -1,  // Offload everything to GPU by default
            n_threads: 0,      // 0 = auto-detect
            n_batch: 2048,
            n_ubatch: 512,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            use_mmap: true,
            flash_attn: true,
        }
    }
}



impl InferenceEngine {
    /// Load a .gguf model from disk into GPU/CPU memory.
    ///
    /// This is where llama-cpp-4 initializes the model with Vulkan/CUDA/Metal
    /// acceleration. The heavy lifting happens entirely in C++ land.
    pub fn load(config: EngineConfig) -> std::result::Result<Self, String> {
        let path = std::path::Path::new(&config.model_path);
        if !path.exists() {
            return Err(format!("Model file not found: {}", config.model_path));
        }

        let model_name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        tracing::info!("⚡ Loading model: {} (ctx={}, use_mmap={}, flash_attn={})", model_name, config.ctx_size, config.use_mmap, config.flash_attn);
        tracing::info!("   GPU layers: {}, Threads: {}",
            if config.n_gpu_layers < 0 { "all".to_string() } else { config.n_gpu_layers.to_string() },
            if config.n_threads == 0 { "auto".to_string() } else { config.n_threads.to_string() }
        );

        // Initialize the llama.cpp backend (CUDA/Vulkan/Metal drivers)
        let backend = LlamaBackend::init()
            .map_err(|e| format!("Failed to initialize llama.cpp backend: {}", e))?;

        // Log system info (CPU features, GPU support, etc.)
        let sys_info = llama_cpp_4::print_system_info();
        tracing::info!("   llama.cpp system info: {}", sys_info);
        tracing::info!("   GPU offload supported: {}", llama_cpp_4::supports_gpu_offload());

        // Configure model params with GPU offloading
        let gpu_layers = if config.n_gpu_layers < 0 {
            // -1 means offload all layers — use a very large number
            999u32
        } else {
            config.n_gpu_layers as u32
        };

        let model_params = LlamaModelParams::default()
            .with_n_gpu_layers(gpu_layers);

        // Load the GGUF model weights into memory
        let model = LlamaModel::load_from_file(&backend, &config.model_path, &model_params)
            .map_err(|e| format!("Failed to load model '{}': {}", config.model_path, e))?;

        tracing::info!("✅ Model loaded: {} (vocab={}, ctx_train={})",
            model_name, model.n_vocab(), model.n_ctx_train());

        Ok(Self {
            model_path: config.model_path,
            model_name,
            ctx_size: config.ctx_size,
            n_threads: config.n_threads,
            n_batch: config.n_batch,
            n_ubatch: config.n_ubatch,
            flash_attn: config.flash_attn,
            backend: Arc::new(backend),
            model: Arc::new(model),
        })
    }

    /// Run streaming inference on a prompt.
    ///
    /// Returns a channel receiver that yields TokenChunk values as the model
    /// generates them. This runs on a dedicated OS thread (not tokio) to avoid
    /// blocking the async runtime.
    pub fn generate_stream(
        &self,
        prompt: &str,
        max_tokens: u32,
        temperature: f32,
        top_p: f32,
        top_k: i32,
        repeat_penalty: f32,
    ) -> tokio::sync::mpsc::Receiver<TokenChunk> {
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        let model = Arc::clone(&self.model);
        let backend = Arc::clone(&self.backend);
        let ctx_size = self.ctx_size;
        let n_batch = self.n_batch;
        let n_ubatch = self.n_ubatch;
        let flash_attn = self.flash_attn;
        let prompt = prompt.to_string();

        // Detect physical CPU cores for SIMD acceleration (e.g. 6 cores)
        let num_threads = if self.n_threads > 0 {
            self.n_threads as i32
        } else {
            std::thread::available_parallelism()
                .map(|n| (n.get() as i32 / 2).max(1).min(8))
                .unwrap_or(6)
        };

        // Spawn on a dedicated OS thread — NOT on tokio's async pool.
        // This is critical because llama.cpp inference is CPU/GPU-bound
        // and would block the async executor if run on a tokio task.
        std::thread::spawn(move || {
            let flash_mode = if flash_attn {
                LlamaFlashAttnType::Enabled
            } else {
                LlamaFlashAttnType::Disabled
            };

            // Create context with multi-threaded hardware configuration & Flash Attention
            let ctx_params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(ctx_size))
                .with_n_threads(num_threads)
                .with_n_threads_batch(num_threads)
                .with_n_batch(n_batch)
                .with_n_ubatch(n_ubatch)
                .with_flash_attn_type(flash_mode);

            let mut ctx = match model.new_context(&backend, ctx_params) {
                Ok(ctx) => ctx,
                Err(e) => {
                    let _ = tx.blocking_send(TokenChunk {
                        text: format!("[ERROR] Failed to create context: {}", e),
                        is_final: true,
                        prompt_tokens: None,
                        prompt_processed: None,
                        metrics: None,
                    });
                    return;
                }
            };

            // Tokenize the prompt
            let tokens = match model.str_to_token(&prompt, AddBos::Always) {
                Ok(t) => t,
                Err(e) => {
                    let _ = tx.blocking_send(TokenChunk {
                        text: format!("[ERROR] Tokenization failed: {}", e),
                        is_final: true,
                        prompt_tokens: None,
                        prompt_processed: None,
                        metrics: None,
                    });
                    return;
                }
            };

            let prompt_tokens_count = tokens.len();
            tracing::debug!("Prompt tokenized: {} tokens", prompt_tokens_count);

            // Emit initial prompt processing notification chunk (0%)
            let _ = tx.blocking_send(TokenChunk {
                text: String::new(),
                is_final: false,
                prompt_tokens: Some(prompt_tokens_count),
                prompt_processed: Some(0),
                metrics: None,
            });

            // Check if prompt fits in context
            if prompt_tokens_count as u32 >= ctx_size {
                let _ = tx.blocking_send(TokenChunk {
                    text: format!(
                        "[ERROR] Prompt too long: {} tokens exceeds context size {}",
                        prompt_tokens_count, ctx_size
                    ),
                    is_final: true,
                    prompt_tokens: Some(prompt_tokens_count),
                    prompt_processed: None,
                    metrics: None,
                });
                return;
            }

            let t_total_start = std::time::Instant::now();
            let t_prompt_start = std::time::Instant::now();

            // Evaluate prompt in batches matching the configured evaluation batch size (e.g. 2048 or 512 tokens)
            // This maximizes GPU parallel compute throughput while streaming live progress.
            let chunk_size = (n_batch as usize).max(256).min(ctx_size as usize);
            let mut batch = LlamaBatch::new(chunk_size, 1);
            let total_tokens = tokens.len();

            for (chunk_idx, token_chunk) in tokens.chunks(chunk_size).enumerate() {
                batch.clear();
                let start_idx = chunk_idx * chunk_size;
                let is_last_chunk = start_idx + token_chunk.len() == total_tokens;

                for (i, &tok) in token_chunk.iter().enumerate() {
                    let pos = (start_idx + i) as i32;
                    let need_logits = is_last_chunk && (i == token_chunk.len() - 1);
                    if let Err(e) = batch.add(tok, pos, &[0], need_logits) {
                        let _ = tx.blocking_send(TokenChunk {
                            text: format!("[ERROR] Batch add failed: {}", e),
                            is_final: true,
                            prompt_tokens: Some(prompt_tokens_count),
                            prompt_processed: None,
                            metrics: None,
                        });
                        return;
                    }
                }

                if let Err(e) = ctx.decode(&mut batch) {
                    let _ = tx.blocking_send(TokenChunk {
                        text: format!("[ERROR] Prompt evaluation failed: {}", e),
                        is_final: true,
                        prompt_tokens: Some(prompt_tokens_count),
                        prompt_processed: None,
                        metrics: None,
                    });
                    return;
                }

                let processed_count = start_idx + token_chunk.len();
                let _ = tx.blocking_send(TokenChunk {
                    text: String::new(),
                    is_final: false,
                    prompt_tokens: Some(prompt_tokens_count),
                    prompt_processed: Some(processed_count),
                    metrics: None,
                });
            }

            let prompt_duration = t_prompt_start.elapsed();
            let prompt_time_ms = prompt_duration.as_secs_f64() * 1000.0;
            let prompt_tps = if prompt_duration.as_secs_f64() > 0.0 {
                (prompt_tokens_count as f64) / prompt_duration.as_secs_f64()
            } else {
                0.0
            };

            // Build the sampler chain: temperature → top_k → top_p → dist
            let seed = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();

            let sampler = LlamaSampler::chain_simple([
                LlamaSampler::temp(temperature),
                LlamaSampler::top_k(top_k),
                LlamaSampler::top_p(top_p, 1),
                LlamaSampler::penalties_simple(64, repeat_penalty),
                LlamaSampler::dist(seed),
            ]);

            // Autoregressive token generation loop
            let mut n_decoded = tokens.len() as i32;
            let mut gen_tokens_count = 0usize;
            let mut generated_accumulator = String::new();
            let t_gen_start = std::time::Instant::now();

            for _ in 0..max_tokens {
                // Sample the next token
                let token = sampler.sample(&ctx, -1);

                // Check for end-of-generation
                if model.is_eog_token(token) {
                    break;
                }

                // Decode token to text
                let piece = match model.token_to_str(token, Special::Plaintext) {
                    Ok(s) => s,
                    Err(_) => {
                        // Some tokens (like byte fallbacks) can't be decoded to UTF-8
                        // Skip them silently
                        continue;
                    }
                };

                gen_tokens_count += 1;
                generated_accumulator.push_str(&piece);

                // Stream the token to the caller
                if tx.blocking_send(TokenChunk {
                    text: piece,
                    is_final: false,
                    prompt_tokens: Some(prompt_tokens_count),
                    prompt_processed: Some(prompt_tokens_count),
                    metrics: None,
                }).is_err() {
                    // Client disconnected, stop generating
                    return;
                }

                // Check for turn-stop and tool-call completion sequences
                let is_tool_call_finished = (generated_accumulator.contains("<call:") || generated_accumulator.contains("<|call:"))
                    && (generated_accumulator.trim_end().ends_with('>') || generated_accumulator.trim_end().ends_with(")>"));

                if generated_accumulator.ends_with("<end_of_turn>")
                    || generated_accumulator.ends_with("<|end_of_turn|>")
                    || generated_accumulator.ends_with("<|im_end|>")
                    || generated_accumulator.ends_with("<|eot_id|>")
                    || generated_accumulator.ends_with("<|turn_end|>")
                    || generated_accumulator.contains("<|user|>")
                    || generated_accumulator.contains("<|USER_PROMPT_START|>")
                    || generated_accumulator.ends_with("</tool_call>")
                    || generated_accumulator.ends_with("<tool_call|>")
                    || generated_accumulator.ends_with("<|tool_call|>")
                    || is_tool_call_finished
                {
                    break;
                }

                // Prepare batch for next token evaluation
                batch.clear();
                if let Err(_) = batch.add(token, n_decoded, &[0], true) {
                    break;
                }

                n_decoded += 1;

                // Evaluate the single-token batch
                if let Err(e) = ctx.decode(&mut batch) {
                    tracing::warn!("Decode error at position {}: {}", n_decoded, e);
                    break;
                }
            }

            let gen_duration = t_gen_start.elapsed();
            let completion_time_ms = gen_duration.as_secs_f64() * 1000.0;
            let completion_tps = if gen_duration.as_secs_f64() > 0.0 {
                (gen_tokens_count as f64) / gen_duration.as_secs_f64()
            } else {
                0.0
            };
            let total_time_ms = t_total_start.elapsed().as_secs_f64() * 1000.0;

            let metrics = InferenceMetrics {
                prompt_tokens: prompt_tokens_count,
                prompt_time_ms,
                prompt_tps,
                completion_tokens: gen_tokens_count,
                completion_time_ms,
                completion_tps,
                total_time_ms,
            };

            // Send the final (empty) chunk with metrics to signal completion
            let _ = tx.blocking_send(TokenChunk {
                text: String::new(),
                is_final: true,
                prompt_tokens: Some(prompt_tokens_count),
                prompt_processed: Some(prompt_tokens_count),
                metrics: Some(metrics),
            });
        });

        rx
    }

    /// Get model metadata for API responses.
    pub fn info(&self) -> EngineInfo {
        EngineInfo {
            model_name: self.model_name.clone(),
            model_path: self.model_path.clone(),
            ctx_size: self.ctx_size,
            n_vocab: self.model.n_vocab(),
            n_ctx_train: self.model.n_ctx_train(),
            gpu_offload: llama_cpp_4::supports_gpu_offload(),
        }
    }

    /// Unload the model from memory.
    /// The llama-cpp-4 model/context will be freed via RAII (Rust Drop).
    pub fn unload(&mut self) {
        tracing::info!("🗑️  Unloading model: {}", self.model_name);
        // Dropping the Arc references will free GPU/CPU memory when refcount hits 0.
        // The actual C++ destructor is called by llama-cpp-4's Drop implementation.
    }
}

#[derive(Debug, Clone)]
pub struct EngineInfo {
    pub model_name: String,
    pub model_path: String,
    pub ctx_size: u32,
    pub n_vocab: i32,
    pub n_ctx_train: u32,
    pub gpu_offload: bool,
}
