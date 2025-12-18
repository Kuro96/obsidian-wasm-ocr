#!/usr/bin/env python3
import sys
import os
import ssl
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Determine the project root and web directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)

if len(sys.argv) > 1:
    WEB_DIR = sys.argv[1]
else:
    WEB_DIR = os.path.join(ROOT_DIR, "tests", "web")

print(f"Switching to Web Directory: {WEB_DIR}")
os.chdir(WEB_DIR)


class COOPCOEPHandler(SimpleHTTPRequestHandler):
    extensions_map = SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update(
        {
            ".wasm": "application/wasm",
        }
    )

    def end_headers(self):
        # Enable SharedArrayBuffer
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


CERT_FILE = os.path.join(SCRIPT_DIR, "cert.pem")
KEY_FILE = os.path.join(SCRIPT_DIR, "key.pem")


def generate_self_signed_cert():
    if not os.path.exists(KEY_FILE) or not os.path.exists(CERT_FILE):
        print("Generating self-signed certificate for HTTPS...")
        # Use openssl to generate a temporary cert
        try:
            subprocess.check_call(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-keyout",
                    KEY_FILE,
                    "-out",
                    CERT_FILE,
                    "-days",
                    "365",
                    "-nodes",
                    "-subj",
                    "/CN=localhost",
                ]
            )
        except FileNotFoundError:
            print("Error: 'openssl' command not found. Cannot generate certificate.")
            print("Please run on localhost, or install openssl to support LAN HTTPS.")
            sys.exit(1)


if __name__ == "__main__":
    port = 8000
    generate_self_signed_cert()

    server_address = ("0.0.0.0", port)
    httpd = HTTPServer(server_address, COOPCOEPHandler)

    # Wrap in SSL
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print("=" * 60)
    print("Server running on HTTPS (Required for SharedArrayBuffer on LAN)")
    print(f"Local:   https://localhost:{port}/index.html")
    print(f"LAN:     https://<YOUR_IP>:{port}/index.html")
    print("\nNOTE: You will see a security warning in the browser because")
    print("      the certificate is self-signed. Click 'Advanced' -> 'Proceed'.")
    print("=" * 60)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
