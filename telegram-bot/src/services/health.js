const http = require('http');
const { port } = require('../config/env');

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'telegram-bot' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`Health server listening on ${port}\n`);
  });
  return server;
}

module.exports = { startHealthServer };