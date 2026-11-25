import http.server, socketserver, os, sys
ROOT = os.path.abspath("tests/.ui-dist")
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def do_GET(s):
        p = s.path.split("?")[0]
        if not os.path.exists(os.path.join(ROOT, p.lstrip("/"))) or p == "/": s.path = "/index.html"
        return super().do_GET()
    def log_message(s, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 5199), H).serve_forever()
