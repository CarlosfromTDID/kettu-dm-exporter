#!/usr/bin/env python3
import http.server
import socket
import socketserver
from pathlib import Path

PORT = 8080
DIST_DIR = Path(__file__).resolve().parent / "dist"


class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    local_ip = get_local_ip()
    print("=" * 76)
    print(" 🦊 SERVIDOR DE INSTALACIÓN DE PLUGIN PARA KETTU / BUNNY / VENDETTA")
    print("=" * 76)
    print(f" Pega esta URL en Kettu -> Plugins -> Añadir (+):\n\n   👉  http://{local_ip}:{PORT}/  👈\n")
    print("=" * 76)
    with socketserver.TCPServer(("0.0.0.0", PORT), CORSRequestHandler) as httpd:
        httpd.serve_forever()
