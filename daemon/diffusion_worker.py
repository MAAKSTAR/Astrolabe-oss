#!/usr/bin/env python3
"""
Astrolabe Dedicated Multimodal Diffusion Engine (Port 47992)
Executes local GGUF / SafeTensors diffusion models via high-performance sd-cli with Vulkan acceleration.
Provides OpenAI-compatible /v1/images/generations endpoint for text-to-image synthesis.
"""

import sys
import os
import json
import time
import base64
import uuid
import subprocess
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = 47992
SD_BIN_DIR = "/home/maakstar/EXOVON_ECOSYSTEM/exovon-daemon/bin"
SD_CLI_PATH = os.path.join(SD_BIN_DIR, "sd-cli")
MODELS_DIR = "/run/media/maakstar/c/AI MODELS"

ACTIVE_CONFIG = {
    "model_path": None,
    "mmproj_path": None,
    "vae_path": None,
    "steps": 4,
    "cfg_scale": 1.8,
    "resolution": "512x512",
    "vae_tiling": True
}

def find_default_diffusion_model() -> str:
    """Find any available diffusion model in the models directory."""
    if ACTIVE_CONFIG.get("model_path") and os.path.exists(ACTIVE_CONFIG["model_path"]):
        return ACTIVE_CONFIG["model_path"]
        
    candidates = []
    if os.path.exists(MODELS_DIR):
        for root, _, files in os.walk(MODELS_DIR):
            for f in files:
                f_lower = f.lower()
                if (f_lower.endswith(".gguf") or f_lower.endswith(".safetensors")) and "mmproj" not in f_lower:
                    if any(k in f_lower for k in ["diffusion", "turbo", "sd", "flux", "wan"]):
                        if not any(llm in f_lower for llm in ["qwen", "gemma", "llama", "bonsai"]):
                            candidates.append(os.path.join(root, f))
    if candidates:
        return candidates[0]
    return None

def resolve_model_path(input_val: str = None) -> str:
    """Resolve a model name or path to an absolute existing file."""
    if input_val:
        if os.path.exists(input_val):
            return input_val
        candidate = os.path.join(MODELS_DIR, input_val)
        if os.path.exists(candidate):
            return candidate
        if not candidate.endswith('.gguf') and os.path.exists(candidate + '.gguf'):
            return candidate + '.gguf'
        base = os.path.basename(input_val).lower()
        if os.path.exists(MODELS_DIR):
            for root, _, files in os.walk(MODELS_DIR):
                for f in files:
                    if f.lower() == base or f.lower() == base + '.gguf' or base in f.lower():
                        return os.path.join(root, f)
    if ACTIVE_CONFIG.get("model_path") and os.path.exists(ACTIVE_CONFIG["model_path"]):
        return ACTIVE_CONFIG["model_path"]
    return find_default_diffusion_model()

def run_diffusion_generation(prompt: str, model_path: str = None, width: int = 512, height: int = 512, steps: int = None, cfg_scale: float = None) -> str:
    """
    Run real diffusion inference via sd-cli.
    Returns base64-encoded PNG string.
    Raises Exception if inference fails.
    """
    if not os.path.exists(SD_CLI_PATH):
        raise FileNotFoundError(f"sd-cli binary not found at {SD_CLI_PATH}")

    target_model = model_path or find_default_diffusion_model()
    if not os.path.exists(target_model):
        raise FileNotFoundError(f"Diffusion model not found: {target_model}")

    model_name_lower = os.path.basename(target_model).lower()
    is_turbo = "turbo" in model_name_lower or "schnell" in model_name_lower
    
    if steps is None or steps <= 0:
        steps = 4 if is_turbo else int(ACTIVE_CONFIG.get("steps") or 20)
    elif is_turbo and steps > 10:
        # For SD-Turbo, steps > 10 degrades quality and slows down without reason
        steps = 4

    if cfg_scale is None or cfg_scale <= 0:
        cfg_scale = 1.8 if is_turbo else float(ACTIVE_CONFIG.get("cfg_scale") or 7.0)

    out_file = f"/tmp/sd_render_{uuid.uuid4().hex}.png"

    cmd = [
        SD_CLI_PATH,
        "-m", target_model,
        "-p", prompt,
        "-o", out_file,
        "-W", str(width),
        "-H", str(height),
        "--steps", str(steps),
        "--cfg-scale", str(cfg_scale),
    ]

    if ACTIVE_CONFIG.get("vae_path") and os.path.exists(ACTIVE_CONFIG["vae_path"]):
        cmd.extend(["--vae", ACTIVE_CONFIG["vae_path"]])
    if ACTIVE_CONFIG.get("vae_tiling"):
        cmd.append("--vae-tiling")

    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = f"{SD_BIN_DIR}:{env.get('LD_LIBRARY_PATH', '')}"

    print(f"🎨 Running real diffusion: {' '.join(cmd)}")
    proc = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=240)

    if proc.returncode != 0:
        err_msg = proc.stderr.strip() or proc.stdout.strip() or f"Process exited with code {proc.returncode}"
        print(f"❌ sd-cli failed: {err_msg}")
        raise RuntimeError(f"Diffusion engine error: {err_msg[-400:]}")

    if not os.path.exists(out_file) or os.path.getsize(out_file) == 0:
        raise RuntimeError("Diffusion completed but no output image was produced.")

    try:
        with open(out_file, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode("utf-8")
        return b64_data
    finally:
        if os.path.exists(out_file):
            try:
                os.remove(out_file)
            except Exception:
                pass

class DiffusionHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        if self.path in ['/v1/health', '/health']:
            self._set_headers(200)
            resp = {
                "status": "ok",
                "service": "Astrolabe Multimodal Diffusion Engine",
                "engine": "stable-diffusion.cpp (Vulkan)",
                "port": PORT,
                "active_config": ACTIVE_CONFIG
            }
            self.wfile.write(json.dumps(resp).encode('utf-8'))
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Not Found"}).encode('utf-8'))

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)

        try:
            req = json.loads(post_data.decode('utf-8')) if post_data else {}
        except Exception:
            req = {}

        if self.path == '/v1/models/load':
            model_path = resolve_model_path(req.get('model_path') or req.get('modelId'))
            if not model_path or not os.path.exists(model_path):
                self._set_headers(404)
                self.wfile.write(json.dumps({"error": f"Image model not found: {model_path or 'No model specified'}"}).encode('utf-8'))
                return

            ACTIVE_CONFIG['model_path'] = model_path
            ACTIVE_CONFIG['mmproj_path'] = req.get('mmproj_path')
            ACTIVE_CONFIG['vae_path'] = req.get('vae_path')
            ACTIVE_CONFIG['steps'] = req.get('steps', 4)
            ACTIVE_CONFIG['cfg_scale'] = req.get('cfg_scale', 1.8)
            ACTIVE_CONFIG['resolution'] = req.get('resolution', '512x512')
            ACTIVE_CONFIG['vae_tiling'] = req.get('vae_tiling', True)
            
            self._set_headers(200)
            resp = {
                "status": "loaded",
                "model": os.path.basename(model_path),
                "model_path": model_path,
                "target": "diffusion",
                "port": PORT,
                "message": f"Multimodal Diffusion Pipeline initialized ({os.path.basename(model_path)})"
            }
            self.wfile.write(json.dumps(resp).encode('utf-8'))
            return

        if self.path == '/v1/models/unload':
            ACTIVE_CONFIG['model_path'] = None
            ACTIVE_CONFIG['mmproj_path'] = None
            ACTIVE_CONFIG['vae_path'] = None
            self._set_headers(200)
            resp = {
                "status": "unloaded",
                "target": "diffusion",
                "port": PORT,
                "message": "Multimodal Diffusion Pipeline unloaded"
            }
            self.wfile.write(json.dumps(resp).encode('utf-8'))
            return

        if self.path == '/v1/images/generations':
            prompt = req.get('prompt', '').strip()
            if not prompt:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "Prompt cannot be empty"}).encode('utf-8'))
                return

            size_str = req.get('size', '512x512')
            w, h = 512, 512
            if 'x' in size_str:
                parts = size_str.split('x')
                try:
                    w = int(parts[0])
                    h = int(parts[1])
                except Exception:
                    pass

            model_path = resolve_model_path(req.get('model'))
            if not model_path or not os.path.exists(model_path):
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "No image model loaded in memory. Please select and load a diffusion model first."}).encode('utf-8'))
                return

            steps = req.get('steps')
            cfg_scale = req.get('cfg_scale')

            try:
                b64_img = run_diffusion_generation(
                    prompt=prompt,
                    model_path=model_path,
                    width=w,
                    height=h,
                    steps=steps,
                    cfg_scale=cfg_scale
                )
                
                now = int(time.time())
                response_payload = {
                    "created": now,
                    "data": [
                        {
                            "b64_json": b64_img,
                            "revised_prompt": prompt,
                            "model": os.path.basename(model_path)
                        }
                    ]
                }

                self._set_headers(200)
                self.wfile.write(json.dumps(response_payload).encode('utf-8'))
            except Exception as e:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return

        self._set_headers(404)
        self.wfile.write(json.dumps({"error": f"Endpoint not found: {self.path}"}).encode('utf-8'))

def run_server():
    server_address = ('127.0.0.1', PORT)
    httpd = ThreadingHTTPServer(server_address, DiffusionHandler)
    default_model = find_default_diffusion_model()
    if default_model and os.path.exists(default_model):
        ACTIVE_CONFIG['model_path'] = default_model
        print(f"📦 Default diffusion model detected: {default_model}")
    print(f"✅ Astrolabe Multimodal Diffusion Engine running on http://127.0.0.1:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Diffusion Engine.")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
