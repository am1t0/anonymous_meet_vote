// Realtime Rating App using Room Codes (Single-file server)
// Usage:
//   1) npm init -y
//   2) npm i express socket.io
//   3) node server.js
//   4) Open http://localhost:3000

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// In-memory room store
const rooms = Object.create(null);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (rooms[code]) return generateRoomCode();
  return code;
}

function getStats(room) {
  const values = Array.from(room.ratings.values());
  const count = values.length;
  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const v of values) {
    if (v >= 1 && v <= 5) {
      distribution[v - 1]++;
      sum += v;
    }
  }
  const avg = count ? +(sum / count).toFixed(2) : 0;
  return { count, avg, distribution };
}

function sanitize(str) {
  return String(str || '').slice(0, 32).toUpperCase();
}

io.on('connection', (socket) => {
  socket.on('create_room', (ack) => {
    const code = generateRoomCode();
    rooms[code] = { creatorId: socket.id, ratings: new Map(), createdAt: Date.now() };
    socket.join(code);
    if (typeof ack === 'function') ack({ ok: true, code });
  });

  socket.on('join_room', (payload = {}, ack) => {
    const code = sanitize(payload.code);
    if (!rooms[code]) return typeof ack === 'function' && ack({ ok: false, error: 'Room not found' });
    socket.join(code);
    if (typeof ack === 'function') ack({ ok: true, code });
    io.to(socket.id).emit('room_update', { code, ...getStats(rooms[code]) });
  });

  socket.on('submit_rating', (payload = {}, ack) => {
    const code = sanitize(payload.code);
    const value = Number(payload.value);
    const room = rooms[code];
    if (!room) return typeof ack === 'function' && ack({ ok: false, error: 'Room not found' });
    if (!(value >= 1 && value <= 5)) return typeof ack === 'function' && ack({ ok: false, error: 'Invalid rating' });
    room.ratings.set(socket.id, value);
    const stats = getStats(room);
    io.to(code).emit('room_update', { code, ...stats });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('clear_ratings', (payload = {}, ack) => {
    const code = sanitize(payload.code);
    const room = rooms[code];
    if (!room) return typeof ack === 'function' && ack({ ok: false, error: 'Room not found' });
    if (room.creatorId !== socket.id) return typeof ack === 'function' && ack({ ok: false, error: 'Only creator can clear' });
    room.ratings.clear();
    const stats = getStats(room);
    io.to(code).emit('room_update', { code, ...stats });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('end_room', (payload = {}, ack) => {
    const code = sanitize(payload.code);
    const room = rooms[code];
    if (!room) return typeof ack === 'function' && ack({ ok: false, error: 'Room not found' });
    if (room.creatorId !== socket.id) return typeof ack === 'function' && ack({ ok: false, error: 'Only creator can end' });
    io.to(code).emit('room_ended', { code });
    delete rooms[code];
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const [code, room] of Object.entries(rooms)) {
      if (room.ratings.has(socket.id)) {
        room.ratings.delete(socket.id);
        io.to(code).emit('room_update', { code, ...getStats(room) });
      }
      if (room.creatorId === socket.id) {
        io.to(code).emit('room_ended', { code });
        delete rooms[code];
      }
    }
  });
});

// Serve minimal client UI
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Realtime Ratings</title>
  <style>
    :root{font-family: system-ui, sans-serif;}
    body{margin:0; background:#f8fafc; color:#0f172a; display:flex; min-height:100vh;}
    .container{max-width:500px; margin:auto; padding:24px; width:100%;}
    .card{background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; box-shadow:0 4px 12px rgba(0,0,0,.05)}
    h1{font-size:24px; margin:0 0 8px; text-align:center}
    .muted{color:#64748b; text-align:center}
    .row{display:flex; gap:8px; flex-wrap:wrap; justify-content:center}
    input[type=text]{flex:1; padding:12px 14px; border-radius:8px; border:1px solid #cbd5e1; font-size:16px}
    button{padding:10px 14px; border-radius:8px; border:1px solid #cbd5e1; background:#2563eb; color:#fff; font-size:16px; cursor:pointer}
    button.secondary{background:#e2e8f0; color:#0f172a}
    .badge{padding:6px 10px; border-radius:6px; background:#f1f5f9; font-weight:600}
    .grid{display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; margin-top:16px}
    .rating-btn{font-size:18px; padding:14px; border-radius:8px; border:1px solid #cbd5e1; background:#f8fafc; cursor:pointer}
    .rating-btn.active{background:#2563eb; border-color:#2563eb; color:#fff}
    .stats{margin-top:16px; text-align:center}
    .bar{height:10px; background:#e2e8f0; border-radius:999px; overflow:hidden; flex:1}
    .bar > div{height:100%; background:#22c55e}
    .flex{display:flex; gap:8px; align-items:center; margin:4px 0}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Realtime Ratings</h1>
      <div class="muted">Create a room or join with a code to vote 1–5</div>
      <div id="setup">
        <div class="row" style="margin-top:16px;">
          <button id="create">Create Room</button>
        </div>
        <div class="row" style="margin-top:8px;">
          <input id="code" type="text" placeholder="Enter Room Code" maxlength="6" />
          <button id="join" class="secondary">Join</button>
        </div>
      </div>
      <div id="room" style="display:none; margin-top:16px;">
        <div style="text-align:center; margin-bottom:12px;">
          Room: <span id="roomCode" class="badge">—</span> | <span id="roleTag">Participant</span>
        </div>
        <div id="ratingGrid" class="grid"></div>
        <div class="stats">
          <div><strong>Average:</strong> <span id="avg">0</span></div>
          <div><strong>Responses:</strong> <span id="count">0</span></div>
        </div>
        <div id="dist"></div>
        <div id="creatorControls" style="display:none; margin-top:12px; text-align:center;">
          <button id="clear" class="secondary">Clear Ratings</button>
          <button id="end" class="secondary">End Room</button>
        </div>
      </div>
    </div>
  </div>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const $ = (id) => document.getElementById(id);
    let currentRoom = null;
    let isCreator = false;
    let myRating = 0;

    // Load from sessionStorage
    if (sessionStorage.roomCode) {
      socket.emit('join_room', { code: sessionStorage.roomCode }, (res) => {
        if (res && res.ok) {
          currentRoom = res.code;
          myRating = Number(sessionStorage.myRating || 0);
          isCreator = false;
          showRoomUI(currentRoom);
          renderRatingButtons();
        } else {
          sessionStorage.clear();
        }
      });
    }

    function renderRatingButtons() {
      const grid = $('ratingGrid');
      grid.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const btn = document.createElement('button');
        btn.className = 'rating-btn' + (myRating === i ? ' active' : '');
        btn.textContent = i;
        btn.onclick = () => {
          if (!currentRoom) return;
          myRating = i;
          sessionStorage.myRating = i;
          sessionStorage.roomCode = currentRoom;
          socket.emit('submit_rating', { code: currentRoom, value: i });
          renderRatingButtons();
        };
        grid.appendChild(btn);
      }
    }

    function renderDistribution(distribution, count) {
      const container = $('dist');
      container.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const row = document.createElement('div');
        row.className = 'flex';
        const label = document.createElement('div');
        label.style.width = '24px';
        label.textContent = i + 1;
        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('div');
        const pct = count ? Math.round((distribution[i] / count) * 100) : 0;
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        const val = document.createElement('div');
        val.style.width = '24px';
        val.textContent = distribution[i];
        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(val);
        container.appendChild(row);
      }
    }

    function showRoomUI(code) {
      $('setup').style.display = 'none';
      $('room').style.display = 'block';
      $('roomCode').textContent = code;
      $('roleTag').textContent = isCreator ? 'Presenter' : 'Participant';
      $('creatorControls').style.display = isCreator ? 'block' : 'none';
    }

    $('create').onclick = () => {
      socket.emit('create_room', (res) => {
        if (!res || !res.ok) return alert('Failed to create room');
        isCreator = true;
        currentRoom = res.code;
        showRoomUI(currentRoom);
        sessionStorage.roomCode = currentRoom;
        renderRatingButtons();
      });
    };

    $('join').onclick = () => {
      const code = $('code').value.trim().toUpperCase();
      if (!code) return alert('Enter a room code');
      socket.emit('join_room', { code }, (res) => {
        if (!res || !res.ok) return alert(res && res.error ? res.error : 'Failed to join');
        isCreator = false;
        currentRoom = res.code;
        sessionStorage.roomCode = currentRoom;
        showRoomUI(currentRoom);
        renderRatingButtons();
      });
    };

    $('clear').onclick = () => {
      if (!currentRoom) return;
      socket.emit('clear_ratings', { code: currentRoom });
      myRating = 0;
      sessionStorage.myRating = 0;
      renderRatingButtons();
    };

    $('end').onclick = () => {
      if (!currentRoom) return;
      if (!confirm('End room for everyone?')) return;
      socket.emit('end_room', { code: currentRoom });
      sessionStorage.clear();
    };

    socket.on('room_update', ({ code, count, avg, distribution }) => {
      if (currentRoom !== code) return;
      $('count').textContent = count;
      $('avg').textContent = avg;
      renderDistribution(distribution, count);
    });

    socket.on('room_ended', ({ code }) => {
      if (currentRoom === code) {
        alert('Room ended by presenter');
        sessionStorage.clear();
        location.reload();
      }
    });

    renderRatingButtons();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log(`Realtime Rating server running on http://localhost:${PORT}`);
});