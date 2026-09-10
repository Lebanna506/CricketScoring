"""Tiny static file server for local development.

Plain `python -m http.server` sends no cache-control headers, so browsers can
silently keep serving old JS/CSS from disk cache across app updates without
even making a network request - which looks exactly like the app being
broken (blank screen, stale behaviour) when it's really just a stale cache.
This wraps the same stdlib server but tells the browser never to cache
anything, since this app is actively updated via `git pull` on every launch.
"""
import sys
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class ReusableServer(ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with ReusableServer(('', PORT), NoCacheHandler) as httpd:
        print(f'Serving HTTP on 0.0.0.0 port {PORT} (http://localhost:{PORT}/) ...')
        print('Cache-Control: no-store is sent on every response, so the app always loads fresh files.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
