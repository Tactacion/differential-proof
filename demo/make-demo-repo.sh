#!/usr/bin/env bash
# Builds a tiny git repo with three branches for the demo:
#   main                 Invoices "Export" button is broken; Reports export works
#   fix-invoice-export   a real fix for the Invoices export
#   fake-fix             an "agent fix" that only touches the Reports page
# Usage: bash demo/make-demo-repo.sh <dir>
set -euo pipefail

DIR="${1:-.demo-repo}"
if [ -e "$DIR" ]; then
  echo "refusing to overwrite existing $DIR" >&2
  exit 1
fi
mkdir -p "$DIR"
cd "$DIR"
git init -q -b main
git config user.email "demo@diffproof.local"
git config user.name "diffproof demo"

cat > package.json <<'EOF'
{
  "name": "diffproof-demo-app",
  "version": "1.0.0",
  "private": true,
  "scripts": { "start": "node server.js" }
}
EOF

cat > server.js <<'EOF'
// Tiny app with two pages. Listens on $PORT (default 3000). No dependencies.
const http = require('node:http');
const port = Number(process.env.PORT || 3000);

const page = (title, script) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:40px}button{font:inherit;padding:8px 16px}#status{color:#0a7}</style>
</head><body>
<nav><a href="/reports">Reports</a> · <a href="/invoices">Invoices</a></nav>
<h1>${title}</h1>
<button id="export">Export</button>
<p id="status" role="status"></p>
<script>${script}</script>
</body></html>`;

const REPORTS_SCRIPT = `document.getElementById('export').onclick = () => {
  document.getElementById('status').textContent = 'Export ready: reports.csv';
};`;

// BUG: exportInvoices is never defined, so the button throws and nothing shows.
const INVOICES_SCRIPT = `document.getElementById('export').onclick = () => exportInvoices();`;

const routes = {
  '/reports': page('Reports', REPORTS_SCRIPT),
  '/invoices': page('Invoices', INVOICES_SCRIPT),
};

http
  .createServer((req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname;
    const html = routes[p === '/' ? '/reports' : p];
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  })
  .listen(port, () => console.log(`demo app on http://127.0.0.1:${port}`));
EOF

cat > README.md <<'EOF'
# diffproof demo app

Two pages, Reports and Invoices, each with an Export button.
On `main`, the Invoices export is broken. Run with `PORT=3000 npm start`.
EOF

git add -A
git commit -q -m "Demo app: Reports and Invoices pages (Invoices export is broken)"

# A real fix: define exportInvoices.
git checkout -q -b fix-invoice-export
node -e '
const fs = require("fs");
const f = "server.js";
const before = "const INVOICES_SCRIPT = `document.getElementById(\x27export\x27).onclick = () => exportInvoices();`;";
const after = "const INVOICES_SCRIPT = `function exportInvoices() {\n  document.getElementById(\x27status\x27).textContent = \x27Export ready: invoices.csv\x27;\n}\ndocument.getElementById(\x27export\x27).onclick = () => exportInvoices();`;";
const s = fs.readFileSync(f, "utf8");
if (!s.includes(before)) { console.error("marker not found in server.js"); process.exit(1); }
fs.writeFileSync(f, s.replace(before, after).replace("// BUG: exportInvoices is never defined, so the button throws and nothing shows.\n", ""));
'
git commit -q -am "Fix Invoices export"

# A plausible-looking "fix" that does not work: it defines exportInvoices but
# leans on window.invoiceExporter, which does not exist, so the click still
# throws. An agent proof recorded on the Reports page would show Export
# working, because Reports export already worked on main — and never runs a
# line this diff changed.
git checkout -q main
git checkout -q -b fake-fix
node -e '
const fs = require("fs");
const f = "server.js";
const before = "const INVOICES_SCRIPT = `document.getElementById(\x27export\x27).onclick = () => exportInvoices();`;";
const after = "const INVOICES_SCRIPT = `function exportInvoices() {\n  window.invoiceExporter.generate(\x27invoices.csv\x27);\n  document.getElementById(\x27status\x27).textContent = \x27Export ready: invoices.csv\x27;\n}\ndocument.getElementById(\x27export\x27).onclick = () => exportInvoices();`;";
const s = fs.readFileSync(f, "utf8");
if (!s.includes(before)) { console.error("marker not found in server.js"); process.exit(1); }
fs.writeFileSync(f, s.replace(before, after).replace("// BUG: exportInvoices is never defined, so the button throws and nothing shows.\n", ""));
'
git commit -q -am "Fix export button"

git checkout -q main
echo "demo repo ready in $DIR (branches: main, fix-invoice-export, fake-fix)"
