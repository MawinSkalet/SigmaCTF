import http from 'node:http';

const flag = process.env.FLAG || 'sigma{default_test_flag}';

const server = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end("User-agent: *\nDisallow: /admin-secret-gate\n");
  }

  if (req.url === '/admin-secret-gate') {
    const cookie = req.headers.cookie || '';
    if (cookie.includes('admin=true')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Vault - Admin Console</title></head>
<body style="background:#050507;color:#22c55e;font-family:monospace;padding:40px;line-height:1.6">
  <h1 style="color:#22c55e">ACCESS GRANTED: GIGACHAD CONSOLE</h1>
  <p>Welcome, Administrator. Here is your secret flag:</p>
  <div style="background:#14161f;border:1px solid #22c55e;padding:20px;display:inline-block;font-size:20px;color:#eab308">
    ${flag}
  </div>
  <p style="color:#888;margin-top:20px">Submit this flag in the SigmaCTF arena to claim your Aura.</p>
</body>
</html>`);
    } else {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>403 Forbidden</title></head>
<body style="background:#050507;color:#ef4444;font-family:monospace;padding:40px;line-height:1.6">
  <h1>403 FORBIDDEN: You Are Cooked 💀</h1>
  <p>Skill Issue. Only administrators with Cookie: <code>admin=true</code> can enter.</p>
</body>
</html>`);
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>The Forbidden Vault</title></head>
<body style="background:#050507;color:#22c55e;font-family:monospace;padding:40px;line-height:1.6">
  <h1>THE FORBIDDEN VAULT</h1>
  <p>Top-secret Sigma archive. Strictly no unauthorized inspection.</p>
  <p style="color:#666">// Hint: Have you checked what search engine crawlers are forbidden from seeing?</p>
</body>
</html>`);
});

server.listen(8080, '0.0.0.0', () => {
  console.log('Forbidden Vault running on port 8080');
});
