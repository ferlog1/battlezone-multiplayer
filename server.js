const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const os = require('os');

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading index.html');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
  } else if (req.url === '/icon.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(); // Empty 200 for missing favicon
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });

const players = {};
let nextId = 1;

wss.on('connection', (ws) => {
  const id = nextId++;
  players[id] = { id, x: 0, z: 0, yaw: 0, team: 'red', hp: 100, weapon: 0, alive: true };

  ws.send(JSON.stringify({ type: 'init', id, players }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          players[id].team = data.team;
          players[id].hp = 100;
          players[id].alive = true;
          broadcast({ type: 'playerJoined', player: players[id] });
          break;
        case 'state':
          if (players[id]) {
            players[id].x = data.x;
            players[id].z = data.z;
            players[id].yaw = data.yaw;
            players[id].hp = data.hp;
            players[id].weapon = data.weapon;
            players[id].alive = data.alive;
          }
          break;
        case 'shoot':
          broadcast({ type: 'playerShot', id, weapon: data.weapon }, ws);
          break;
        case 'hit':
          // data: targetId, damage, killerId
          if (players[data.targetId]) {
            players[data.targetId].hp -= data.damage;
            if (players[data.targetId].hp <= 0) {
              players[data.targetId].hp = 0;
              players[data.targetId].alive = false;
              broadcast({ type: 'kill', killer: id, victim: data.targetId });
            } else {
              broadcast({ type: 'playerHit', id: data.targetId, hp: players[data.targetId].hp });
            }
          }
          break;
        case 'botSync':
          // Host sends bot data, forward to others
          broadcast({ type: 'botSync', bots: data.bots }, ws);
          break;
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    delete players[id];
    broadcast({ type: 'playerLeft', id });
  });
});

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client !== excludeWs) {
      client.send(msg);
    }
  });
}

setInterval(() => {
  broadcast({ type: 'sync', players });
}, 50); // 20 tick rate

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`\n=================================================`);
  console.log(`🚀 BATTLEZONE LAN SERVER RUNNING!`);
  console.log(`=================================================`);
  console.log(`Local (Host):  http://localhost:${PORT}`);
  console.log(`LAN (Others):  http://${ip}:${PORT}`);
  console.log(`=================================================\n`);
});
