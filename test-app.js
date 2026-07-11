const http = require('http');
const html = `
<!DOCTYPE html>
<html>
<head>
<title>Test App</title>
<style>
body { font-family: sans-serif; padding: 50px; background: #1a1a1a; color: white; }
.box { padding: 20px; background: #333; margin-bottom: 10px; border-radius: 5px; }
.btn { padding: 10px 20px; background: #3b82f6; border: none; color: white; cursor: pointer; }
</style>
</head>
<body>
    <h1>Exovon Test App</h1>
    <div class="box">
        <h2>Hover me!</h2>
        <p>This is a paragraph inside the box.</p>
        <button class="btn">Click Me</button>
    </div>
</body>
</html>
`;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
});
server.listen(3015, () => console.log('Test App on 3015'));
