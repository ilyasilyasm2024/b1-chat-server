require('dotenv').config();
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET;

const rawOrigins = process.env.CORS_ORIGIN || '*';
const allowedOrigins = rawOrigins.split(',');

// HTTP server for health check + CORS preflight
const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('B1 Chat Server');
  }
});

const wss = new WebSocketServer({ server });

// Verify JWT on connection
wss.on('connection', (ws, req) => {
  // Extract token from query string: ws://host?token=xxx
  const params = url.parse(req.url, true).query;
  const token = params.token;

  if (!token) {
    ws.send(JSON.stringify({ error: 'Authentication required' }));
    ws.close(4001, 'No token provided');
    return;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    ws.send(JSON.stringify({ error: 'Invalid or expired token' }));
    ws.close(4002, 'Invalid token');
    return;
  }

  // Attach user info to the socket
  ws.username = decoded.username;
  ws.userId = decoded.userId;

  console.log(`[+] ${ws.username} connected. Total: ${wss.clients.size}`);

  // Broadcast updated client count to all
  const broadcastCount = () => {
    const countMsg = JSON.stringify({ type: 'clientCount', count: wss.clients.size });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(countMsg);
    });
  };
  broadcastCount();

  // Send welcome
  ws.send(JSON.stringify({
    id: 'system-' + Date.now(),
    username: 'System',
    text: `Willkommen, @${ws.username}! 🎓`,
    timestamp: Date.now(),
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Validate
      if (!msg.text || typeof msg.text !== 'string' || msg.text.length > 200) return;

      const broadcast = JSON.stringify({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        username: ws.username, // Use verified username, not client-provided
        text: msg.text.slice(0, 200),
        timestamp: Date.now(),
      });

      // Forward to ALL connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(broadcast);
        }
      });
    } catch (err) {
      // Invalid message, ignore
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${ws.username} disconnected. Total: ${wss.clients.size}`);
    broadcastCount();
  });
});

server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
