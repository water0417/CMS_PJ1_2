// Disposable browser fault/trace proxy. Not part of production routing.
const http = require('node:http'),
  fs = require('node:fs');
const trace = [];
const prefix = process.env.UI_EVIDENCE_PREFIX || 'square-community';
const file = `test-results/${prefix}-browser-requests.json`;
const faults = process.env.UI_FAULT_FILE || 'test-results/.square-ui-faults.json';
http
  .createServer((req, res) => {
    const mode = fs.existsSync(faults)
      ? JSON.parse(fs.readFileSync(faults, 'utf8'))
      : {};
    const tracked =
      req.method === 'GET' && /^\/api\/(square|communities|community-invitations)/.test(req.url);
    const entry = tracked ? { url: req.url, started: new Date().toISOString() } : null;
    const record = (status, data) => {
      if (entry) {
        trace.push({ ...entry, status, response: data, finished: new Date().toISOString() });
        fs.writeFileSync(file, JSON.stringify(trace, null, 2));
      }
    };
    const pending = req.url.startsWith('/api/community-invitations/pending-count');
    const card = mode.overviewId && req.url === `/api/communities/${mode.overviewId}/overview`;
    if ((mode.pending && pending) || card) {
      const status = card ? 503 : 404;
      const body = {
        code: card ? 'TEST_UNAVAILABLE' : 'REQUEST',
        message: card
          ? '独立测试：服务暂不可用'
          : 'Cannot GET /api/community-invitations/pending-count',
      };
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      record(status, body);
      return;
    }
    const up = http.request(
      {
        hostname: '127.0.0.1',
        port: 3121,
        path: req.url,
        method: req.method,
        headers: {...req.headers,...(tracked?{'if-none-match':'','if-modified-since':''}:{})},
      },
      (r) => {
        const chunks = [];
        r.on('data', (b) => chunks.push(b));
        r.on('end', () => {
          const data = Buffer.concat(chunks);
          const delay =
            mode.delay && new URL(req.url, 'http://local').searchParams.get('search') === '分页'
              ? 1500
              : 0;
          setTimeout(() => {
            res.writeHead(r.statusCode, { ...r.headers, 'cache-control': 'no-store' });
            res.end(data);
            if (tracked) {
              let parsed;
              try {
                parsed = JSON.parse(data.toString());
              } catch {
                parsed = data.toString();
              }
              record(r.statusCode, parsed);
            }
          }, delay);
        });
      },
    );
    up.on('error', () => {
      const body = { code: 'TEST_UPSTREAM', message: '测试服务不可用' };
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      record(502, body);
    });
    req.pipe(up);
  })
  .listen(3122, '127.0.0.1', () => console.log('Independent browser proxy3122 -> API3121'));
