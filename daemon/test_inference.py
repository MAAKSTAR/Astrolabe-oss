import requests
import json
import time
import sys

BASE_URL = "http://127.0.0.1:47990/v1"
MODEL_URL = "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
FILENAME = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

def check_health():
    print("🏥 Checking daemon health...")
    try:
        r = requests.get(f"{BASE_URL}/health")
        r.raise_for_status()
        print(f"✅ Health OK: {json.dumps(r.json(), indent=2)}")
        return True
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return False

def download_model():
    print(f"📥 Downloading model {FILENAME} from HuggingFace...")
    print("   (This might take a minute depending on your connection. The daemon tracks progress internally.)")
    try:
        r = requests.post(f"{BASE_URL}/models/download", json={
            "url": MODEL_URL,
            "filename": FILENAME
        })
        r.raise_for_status()
        res = r.json()
        print(f"✅ Model downloaded to: {res.get('path')}")
        return res.get('path')
    except Exception as e:
        print(f"❌ Download failed: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"   Server replied: {e.response.text}")
        return None

def load_model(path):
    print(f"🧠 Loading model into memory (offloading to GPU if available)...")
    try:
        r = requests.post(f"{BASE_URL}/models/load", json={
            "model_path": path,
            "n_gpu_layers": -1, # Offload all
            "ctx_size": 2048
        })
        r.raise_for_status()
        print(f"✅ Model loaded: {r.json().get('model')}")
        return True
    except Exception as e:
        print(f"❌ Load failed: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"   Server replied: {e.response.text}")
        return False

def chat():
    print("💬 Sending chat completion request...")
    prompt = "Write a short poem about a rusty robot who wants to learn Rust programming."
    print(f"\nUser: {prompt}\nAssistant: ", end="", flush=True)
    
    try:
        with requests.post(f"{BASE_URL}/chat/completions", json={
            "model": "tinyllama",
            "messages": [
                {"role": "system", "content": "You are a helpful AI assistant."},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 150,
            "temperature": 0.7,
            "stream": True
        }, stream=True) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            delta = chunk["choices"][0]["delta"]
                            if "content" in delta:
                                print(delta["content"], end="", flush=True)
                        except json.JSONDecodeError:
                            pass
            print("\n\n✅ Stream complete!")
    except Exception as e:
        print(f"\n❌ Chat failed: {e}")

if __name__ == "__main__":
    # Wait for server to start if running script concurrently
    time.sleep(2)
    
    if not check_health():
        sys.exit(1)
        
    path = download_model()
    if not path:
        sys.exit(1)
        
    if not load_model(path):
        sys.exit(1)
        
    chat()
