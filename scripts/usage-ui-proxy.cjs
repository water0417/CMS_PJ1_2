// Local test-only observation proxy with deterministic delayed real API responses.
const http = require('node:http'),
  fs = require('node:fs');
const fixture = JSON.parse(fs.readFileSync('test-results/usage-ui-fixtures.json', 'utf8'));
const trace = fs.existsSync('test-results/usage-ui-requests.json')
  ? JSON.parse(fs.readFileSync('test-results/usage-ui-requests.json', 'utf8'))
  : [];
http
  .createServer((req, res) => {
    const tracked = /\/questions\/[^/]+\/(usage|statistics)/.test(req.url);
    const entry = tracked ? { url: req.url, started: new Date().toISOString() } : null;
    const headers = { ...req.headers };
    if (tracked) {
      delete headers['if-none-match'];
      delete headers['if-modified-since'];
    }
    const upstream = http.request(
      { hostname: '127.0.0.1', port: 3107, path: req.url, method: req.method, headers },
      (r) => {
        const chunks = [];
        r.on('data', (d) => chunks.push(d));
        r.on('end', () => {
          const body = Buffer.concat(chunks);
          const delay = tracked
            ? req.url.includes(fixture.roomA._id)
              ? 1200
              : req.url.includes(fixture.roomB._id)
                ? 40
                : 400
            : 0;
          setTimeout(() => {
            res.writeHead(r.statusCode, {
              ...r.headers,
              ...(tracked ? { 'cache-control': 'no-store' } : {}),
            });
            res.end(body);
            if (entry) {
              Object.assign(entry, {
                status: r.statusCode,
                delay,
                finished: new Date().toISOString(),
                response: JSON.parse(body.toString()),
              });
              trace.push(entry);
              fs.writeFileSync(
                'test-results/usage-ui-requests.json',
                JSON.stringify(trace, null, 2),
              );
            }
          }, delay);
        });
      },
    );
    upstream.on('error', (e) => {
      res.writeHead(502);
      res.end(e.message);
    });
    req.pipe(upstream);
  })
  .listen(3108, '127.0.0.1', () =>
    console.log('Isolated browser test proxy3108 → test API3107; A1200ms / B40ms / personal400ms'),
  );
