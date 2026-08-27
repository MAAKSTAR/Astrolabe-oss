import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { INSPECTOR_SCRIPT } from './InspectorScript';

export class InspectorProxy {
    public static activeProxy: InspectorProxy | null = null;
    
    private server: http.Server | null = null;
    private targetPort: number = 0;
    private proxyPort: number = 0;
    private onElementSelected: (elementData: any) => void;
    private sseClients: http.ServerResponse[] = [];

    constructor(onElementSelected: (elementData: any) => void) {
        this.onElementSelected = onElementSelected;
        InspectorProxy.activeProxy = this;
    }
    public pushSSEEvent(type: string, payload: any) {
        const data = JSON.stringify({ type, ...payload });
        this.sseClients.forEach(client => {
            try {
                client.write(`data: ${data}\n\n`);
            } catch (e) {}
        });
    }

    public async start(targetPort: number): Promise<number> {
        if (this.server && this.targetPort === targetPort && this.proxyPort) {
            // Already running for this port, just return the existing proxy port
            return this.proxyPort;
        }

        if (this.server) {
            this.stop();
        }

        this.targetPort = targetPort;
        this.server = http.createServer((req, res) => this.handleRequest(req, res));
        this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
        
        return new Promise((resolve, reject) => {
            this.server?.listen(0, '127.0.0.1', () => {
                const address = this.server?.address();
                if (address && typeof address !== 'string') {
                    this.proxyPort = address.port;
                    console.log(`Inspector Proxy running on port ${this.proxyPort}, forwarding to ${this.targetPort}`);
                    resolve(this.proxyPort);
                } else {
                    reject(new Error('Failed to bind proxy server'));
                }
            });
            
            this.server?.on('error', (err) => reject(err));
        });
    }

    public stop() {
        if (this.server) {
            this.sseClients.forEach(c => c.end());
            this.sseClients = [];
            if ((this.server as any).closeAllConnections) {
                (this.server as any).closeAllConnections();
            }
            this.server.close();
            this.server = null;
        }
    }

    private handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse) {
        // Handle SSE endpoint
        if (clientReq.method === 'GET' && clientReq.url === '/__exovon_sse') {
            clientRes.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            this.sseClients.push(clientRes);
            clientReq.on('close', () => {
                this.sseClients = this.sseClients.filter(c => c !== clientRes);
            });
            return;
        }

        // Handle inspector callback
        if (clientReq.method === 'POST' && clientReq.url === '/__exovon_inspector') {
            let body = '';
            clientReq.on('data', chunk => { body += chunk.toString(); });
            clientReq.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    this.onElementSelected(data);
                    clientRes.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    clientRes.end(JSON.stringify({ success: true }));
                } catch (e) {
                    clientRes.writeHead(400);
                    clientRes.end('Invalid JSON');
                }
            });
            return;
        }

        // Forward options requests (CORS)
        if (clientReq.method === 'OPTIONS' && clientReq.url === '/__exovon_inspector') {
            clientRes.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            clientRes.end();
            return;
        }

        clientReq.on('error', () => {});
        clientRes.on('error', () => {});

        const headers = { ...clientReq.headers, host: `localhost:${this.targetPort}` };
        // Delete accept-encoding so the dev server returns raw HTML instead of gzip
        delete headers['accept-encoding'];

        const options = {
            hostname: 'localhost',
            port: this.targetPort,
            path: clientReq.url,
            method: clientReq.method,
            headers: headers
        };

        const proxyReq = http.request(options, (proxyRes) => {
            proxyRes.on('error', () => {});
            
            const isHtml = proxyRes.headers['content-type']?.includes('text/html');
            
            if (isHtml) {
                // Intercept and inject script
                let bodyHtml = '';
                
                const encoding = proxyRes.headers['content-encoding'];
                let stream: any = proxyRes;
                
                if (encoding === 'gzip') {
                    stream = proxyRes.pipe(zlib.createGunzip());
                } else if (encoding === 'deflate') {
                    stream = proxyRes.pipe(zlib.createInflate());
                } else if (encoding === 'br') {
                    stream = proxyRes.pipe(zlib.createBrotliDecompress());
                }
                
                stream.on('data', (chunk: any) => { bodyHtml += chunk.toString(); });
                stream.on('end', () => {
                    const scriptTag = `\n<script type="text/javascript" id="exovon-inspector-script">\n${INSPECTOR_SCRIPT}\n</script>\n`;
                    let injectedHtml = bodyHtml;
                    if (bodyHtml.includes('</body>')) {
                        injectedHtml = bodyHtml.replace('</body>', () => `${scriptTag}</body>`);
                    } else {
                        injectedHtml += scriptTag;
                    }

                    // Remove headers that might break injection or block inline scripts
                    const headers = { ...proxyRes.headers };
                    delete headers['content-length'];
                    delete headers['content-encoding']; // We decompressed it!
                    delete headers['content-security-policy'];
                    delete headers['content-security-policy-report-only'];
                    delete headers['x-webkit-csp'];
                    delete headers['x-content-security-policy'];
                    delete headers['x-frame-options'];
                    
                    clientRes.writeHead(proxyRes.statusCode || 200, headers);
                    clientRes.end(injectedHtml);
                });
                
                stream.on('error', (err: any) => {
                    console.error('Decompression error:', err);
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(500);
                        clientRes.end('Proxy Decompression Error');
                    }
                });
            } else {
                // Pipe directly
                const headers = { ...proxyRes.headers };
                delete headers['x-frame-options'];
                delete headers['content-security-policy'];
                clientRes.writeHead(proxyRes.statusCode || 200, headers);
                proxyRes.pipe(clientRes, { end: true });
            }
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy Error:', err);
            if (!clientRes.headersSent) {
                clientRes.writeHead(502);
                clientRes.end('Bad Gateway');
            }
        });

        if (['GET', 'HEAD', 'OPTIONS'].includes(clientReq.method || 'GET')) {
            proxyReq.end();
        } else {
            clientReq.pipe(proxyReq, { end: true });
        }
    }

    private handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer) {
        const options = {
            port: this.targetPort,
            hostname: 'localhost',
            method: req.method,
            path: req.url,
            headers: req.headers
        };

        const proxyReq = http.request(options);
        proxyReq.on('error', (err) => {
            console.error('WebSocket Proxy Error:', err);
            socket.end();
        });

        proxyReq.on('response', (res) => {
            res.on('error', () => {});
            socket.write(`HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\r\n`);
            for (const [key, value] of Object.entries(res.headers)) {
                socket.write(`${key}: ${value}\r\n`);
            }
            socket.write('\r\n');
            res.pipe(socket);
        });

        proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            socket.on('error', () => {});
            proxySocket.on('error', () => {});
            
            socket.write(`HTTP/${req.httpVersion} 101 Switching Protocols\r\n`);
            for (const [key, value] of Object.entries(proxyRes.headers)) {
                socket.write(`${key}: ${value}\r\n`);
            }
            socket.write('\r\n');
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
        });

        proxyReq.end();
    }
}
