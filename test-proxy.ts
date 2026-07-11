import * as http from 'http';
import * as zlib from 'zlib';

// Minimal mock of the proxy logic
function createProxy(targetPort) {
    return http.createServer((clientReq, clientRes) => {
        const options = {
            hostname: 'localhost',
            port: targetPort,
            path: clientReq.url,
            method: clientReq.method,
            headers: { ...clientReq.headers, host: `localhost:${targetPort}` }
        };
        delete options.headers['accept-encoding']; // we still delete it

        const proxyReq = http.request(options, (proxyRes) => {
            const isHtml = proxyRes.headers['content-type']?.includes('text/html');
            if (isHtml) {
                let bodyHtml = '';
                const encoding = proxyRes.headers['content-encoding'];
                let stream = proxyRes;
                
                if (encoding === 'gzip') {
                    stream = proxyRes.pipe(zlib.createGunzip());
                }
                
                stream.on('data', chunk => bodyHtml += chunk.toString());
                stream.on('end', () => {
                    let injected = bodyHtml.replace('</body>', '<script>alert("injected")</script></body>');
                    const headers = { ...proxyRes.headers };
                    delete headers['content-length'];
                    delete headers['content-encoding'];
                    clientRes.writeHead(200, headers);
                    clientRes.end(injected);
                });
            } else {
                clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                proxyRes.pipe(clientRes);
            }
        });
        proxyReq.end();
    });
}

// Target server that FORCES gzip
const target = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Encoding': 'gzip'
    });
    const html = '<html><body><h1>Hello</h1></body></html>';
    zlib.gzip(html, (err, buffer) => {
        res.end(buffer);
    });
});

target.listen(8126, () => {
    console.log('Target on 8126');
    const proxy = createProxy(8126);
    proxy.listen(8127, () => {
        console.log('Proxy on 8127');
        http.get('http://127.0.0.1:8127', (res) => {
            let body = '';
            res.on('data', d => body += d.toString());
            res.on('end', () => {
                console.log('FINAL HTML:', body);
                process.exit(0);
            });
        });
    });
});
