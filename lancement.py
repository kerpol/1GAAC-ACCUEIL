from __future__ import annotations

import os
import shlex
import subprocess
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import TCPServer


def main() -> int:
	root_dir = Path(__file__).resolve().parent
	html_path = (root_dir / "index.html").resolve()
	if not html_path.exists():
		print(f"Error: {html_path} not found.", file=sys.stderr)
		return 1

	port = 8000
	url = f"http://127.0.0.1:{port}/index.html"
	httpd: TCPServer | None = None

	class ReusableTCPServer(TCPServer):
		allow_reuse_address = True

	def run_server() -> None:
		nonlocal httpd
		os.chdir(root_dir)
		with ReusableTCPServer(("127.0.0.1", port), SimpleHTTPRequestHandler) as server:
			httpd = server
			server.serve_forever()

	server_thread = threading.Thread(target=run_server, daemon=True)
	server_thread.start()

	# Try standard webbrowser first (avoid blocking the main thread).
	opened = False
	def _open_browser() -> None:
		nonlocal opened
		try:
			opened = webbrowser.open(url)
		except Exception:
			pass

	browser_thread = threading.Thread(target=_open_browser, daemon=True)
	browser_thread.start()

	# In containers, webbrowser may not reach the host. Fall back to $BROWSER.
	browser_cmd = os.environ.get("BROWSER")
	if browser_cmd:
		try:
			subprocess.run(shlex.split(browser_cmd) + [url], check=False)
			opened = True
		except (OSError, ValueError):
			pass

	if not opened:
		print("Opened URL (copy into your browser):")
		print(url)

	print("Server running. Press Ctrl+C to stop.")
	try:
		server_thread.join()
	except KeyboardInterrupt:
		if httpd:
			httpd.shutdown()
			httpd.server_close()
		print("\nServer stopped.")

	return 0


if __name__ == "__main__":
	raise SystemExit(main())
