#!/usr/bin/env python3
import sys
import os
import signal
import json
import urllib.request
import urllib.error
import subprocess
import threading
import time
import gi

gi.require_version('Gtk', '3.0')
try:
    gi.require_version('AyatanaAppIndicator3', '0.1')
    from gi.repository import AyatanaAppIndicator3 as AppIndicator3
except (ValueError, ImportError):
    gi.require_version('AppIndicator3', '0.1')
    from gi.repository import AppIndicator3

from gi.repository import Gtk, GLib

APPINDICATOR_ID = 'exovon-engine-indicator'
DAEMON_URL = 'http://127.0.0.1:47990'
ICON_PATH = '/home/maakstar/EXOVON_ECOSYSTEM/exovonhub/media/icon.png'

class ExovonTrayApp:
    def __init__(self):
        icon_to_use = ICON_PATH if os.path.exists(ICON_PATH) else 'utilities-terminal'
        self.indicator = AppIndicator3.Indicator.new(
            APPINDICATOR_ID,
            icon_to_use,
            AppIndicator3.IndicatorCategory.APPLICATION_STATUS
        )
        self.indicator.set_status(AppIndicator3.IndicatorStatus.ACTIVE)
        
        self.active_model = None
        self.is_running = False
        self.hardware_gpu = "Vulkan GPU"
        self.last_models_cache = []
        self.last_state_signature = None

        self.menu = Gtk.Menu()
        self.build_initial_menu()
        self.indicator.set_menu(self.menu)

        # Start background polling thread to eliminate UI stuttering & freezing
        self.stop_event = threading.Event()
        self.poll_thread = threading.Thread(target=self._background_poll_loop, daemon=True)
        self.poll_thread.start()

    def http_get(self, path, timeout=1.0):
        try:
            req = urllib.request.Request(f"{DAEMON_URL}{path}", headers={'User-Agent': 'ExovonTray/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode('utf-8'))
        except Exception:
            return None

    def http_post_async(self, path, payload=None, callback=None):
        def _do_post():
            try:
                data = json.dumps(payload).encode('utf-8') if payload else None
                headers = {'Content-Type': 'application/json'} if payload else {}
                req = urllib.request.Request(f"{DAEMON_URL}{path}", data=data, headers=headers, method='POST')
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    success = resp.status in (200, 204)
            except Exception as e:
                print(f"POST Error: {e}", file=sys.stderr)
                success = False
            
            if callback:
                GLib.idle_add(callback, success)
            # Trigger immediate poll update
            self._fetch_and_apply_state()

        threading.Thread(target=_do_post, daemon=True).start()

    def build_initial_menu(self):
        # 1. Open Astrolabe / IDE
        self.item_open = Gtk.MenuItem(label='Open Astrolabe')
        self.item_open.connect('activate', self.on_open_astrolabe)
        self.menu.append(self.item_open)

        self.menu.append(Gtk.SeparatorMenuItem())

        # 2. Engine Status
        self.item_status = Gtk.MenuItem(label="Engine: Checking...")
        self.item_status.set_sensitive(False)
        self.menu.append(self.item_status)

        # 3. Active Model
        self.item_model = Gtk.MenuItem(label="Model: Initializing...")
        self.item_model.set_sensitive(False)
        self.menu.append(self.item_model)

        self.menu.append(Gtk.SeparatorMenuItem())

        # 4. Load Model Submenu
        self.item_load = Gtk.MenuItem(label='Load Model')
        self.submenu_models = Gtk.Menu()
        self.item_load.set_submenu(self.submenu_models)
        self.menu.append(self.item_load)

        # 5. Unload Model
        self.item_unload = Gtk.MenuItem(label='Unload Model (Free Memory)')
        self.item_unload.connect('activate', self.on_unload_model)
        self.item_unload.set_no_show_all(False)
        self.menu.append(self.item_unload)

        self.sep_controls = Gtk.SeparatorMenuItem()
        self.menu.append(self.sep_controls)

        # 6. Daemon Controls
        self.item_daemon = Gtk.MenuItem(label='Start Inference Daemon')
        self.item_daemon.connect('activate', self.on_toggle_daemon)
        self.menu.append(self.item_daemon)

        self.item_logs = Gtk.MenuItem(label='View Daemon Logs')
        self.item_logs.connect('activate', self.on_view_logs)
        self.menu.append(self.item_logs)

        self.menu.append(Gtk.SeparatorMenuItem())

        # 7. Quit
        self.item_quit = Gtk.MenuItem(label='Quit Exovon Tray')
        self.item_quit.connect('activate', self.on_quit)
        self.menu.append(self.item_quit)

        self.menu.show_all()
        self.item_unload.hide()

    def _background_poll_loop(self):
        while not self.stop_event.is_set():
            self._fetch_and_apply_state()
            # Poll interval: 2 seconds
            for _ in range(20):
                if self.stop_event.is_set():
                    break
                time.sleep(0.1)

    def _fetch_and_apply_state(self):
        health = self.http_get('/v1/health', timeout=1.0)
        is_running = bool(health and health.get('status') == 'ok')
        active_model = health.get('active_model') if is_running else None
        hw = health.get('hardware', {}) if is_running else {}
        hardware_gpu = hw.get('gpu', 'Vulkan GPU')

        models_list = []
        if is_running:
            models_data = self.http_get('/v1/models', timeout=1.0)
            if models_data and 'models' in models_data:
                models_list = models_data['models']

        state_signature = (is_running, active_model, hardware_gpu, len(models_list), tuple(m.get('id', '') for m in models_list))
        
        # Only notify GTK thread if state actually changed
        if state_signature != self.last_state_signature:
            self.last_state_signature = state_signature
            state_payload = {
                'is_running': is_running,
                'active_model': active_model,
                'hardware_gpu': hardware_gpu,
                'models_list': models_list
            }
            GLib.idle_add(self._apply_state_to_ui, state_payload)

    def _apply_state_to_ui(self, state):
        self.is_running = state['is_running']
        self.active_model = state['active_model']
        self.hardware_gpu = state['hardware_gpu']
        models_list = state['models_list']

        # Update Engine Status
        if self.is_running:
            self.item_status.set_label("Engine: Running (127.0.0.1:47990)")
            if self.active_model:
                self.item_model.set_label(f"Model: {self.active_model}")
            else:
                self.item_model.set_label("No Models Loaded")
            self.item_load.set_sensitive(True)
            self.item_daemon.set_label("Restart Inference Daemon")
            if self.active_model:
                self.item_unload.show()
            else:
                self.item_unload.hide()
        else:
            self.item_status.set_label("Engine: Offline")
            self.item_model.set_label("Daemon Not Running")
            self.item_load.set_sensitive(False)
            self.item_unload.hide()
            self.item_daemon.set_label("Start Inference Daemon")

        # Update Submenu Items cleanly without recreating whole menu
        for child in self.submenu_models.get_children():
            self.submenu_models.remove(child)

        if self.is_running:
            if models_list:
                for m in models_list:
                    mid = m.get('id', '')
                    mname = m.get('name', mid)
                    size = m.get('size_display', '')
                    label = f"{mname} ({size})" if size else mname
                    if mid == self.active_model:
                        label = f"✓ {label}"

                    sub_item = Gtk.MenuItem(label=label)
                    sub_item.connect('activate', self.on_load_model, mid)
                    self.submenu_models.append(sub_item)
            else:
                empty_item = Gtk.MenuItem(label='No local models found')
                empty_item.set_sensitive(False)
                self.submenu_models.append(empty_item)
        else:
            empty_item = Gtk.MenuItem(label='Daemon Offline')
            empty_item.set_sensitive(False)
            self.submenu_models.append(empty_item)

        self.submenu_models.show_all()
        return False

    def on_open_astrolabe(self, widget):
        subprocess.Popen(['astrolabe'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def on_load_model(self, widget, model_id):
        payload = {
            "model_path": model_id,
            "model_id": model_id,
            "ctx_size": 8192,
            "n_gpu_layers": -1,
            "n_threads": 4,
            "n_batch": 2048,
            "n_ubatch": 512,
            "use_mmap": False,
            "flash_attn": True
        }
        self.item_model.set_label(f"Loading {model_id}...")
        self.http_post_async('/v1/models/load', payload)

    def on_unload_model(self, widget):
        self.item_model.set_label("Unloading model...")
        self.http_post_async('/v1/models/unload')

    def on_toggle_daemon(self, widget):
        if self.is_running:
            self.on_restart_daemon(widget)
        else:
            self.on_start_daemon(widget)

    def on_start_daemon(self, widget):
        daemon_bin = '/home/maakstar/EXOVON_ECOSYSTEM/exovon-daemon/target/release/exovon-daemon'
        if os.path.exists(daemon_bin):
            daemon_dir = os.path.dirname(daemon_bin)
            env = os.environ.copy()
            env['LD_LIBRARY_PATH'] = f"{daemon_dir}:{os.path.join(daemon_dir, 'deps')}:{env.get('LD_LIBRARY_PATH', '')}"
            subprocess.Popen([daemon_bin, '--models-dir', '/run/media/maakstar/c/AI MODELS'],
                             env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            GLib.timeout_add_seconds(1, lambda: (self._fetch_and_apply_state(), False)[1])

    def on_restart_daemon(self, widget):
        os.system('pkill -f exovon-daemon')
        GLib.timeout_add_seconds(1, lambda: (self.on_start_daemon(widget), False)[1])

    def on_view_logs(self, widget):
        subprocess.Popen(['xdg-open', '/tmp/exovon_daemon_spawn.log'],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def on_quit(self, widget):
        self.stop_event.set()
        Gtk.main_quit()

def main():
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    app = ExovonTrayApp()
    Gtk.main()

if __name__ == '__main__':
    main()
