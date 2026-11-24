import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import * as Engine from './src/index.js';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Kendi web sitenizden gelen bağlantılara izin verir
    methods: ["GET", "POST"]
  }
});

app.get('/', (req, res) => {
  res.send('101 Okey Sunucusu Aktif! Motor Fonksiyonlari: ' + Object.keys(Engine).join(', '));
});

let game = null;
let players = [null, null, null, null];

function startNewGame() {
  if (Engine.createHand101) {
    game = Engine.createHand101({ playerCount: 4 });
  } else if (Engine.createMatch) {
    game = Engine.createMatch({ mode: '101' });
  }
  broadcastState();
  checkBotTurn();
}

function broadcastState() {
  if (!game) return;
  players.forEach((socketId, seatIndex) => {
    if (socketId && socketId !== 'BOT') {
      const state = typeof game.getPublicState === 'function' ? game.getPublicState(seatIndex) : game;
      io.to(socketId).emit('gameState', { seatIndex, players, state });
    }
  });
}

function checkBotTurn() {
  if (!game || game.isFinished) return;
  const currentSeat = game.currentTurn ?? game.turn ?? 0;
  if (players[currentSeat] === 'BOT' || players[currentSeat] === null) {
    setTimeout(() => {
      try {
        if (typeof Engine.chooseBotMove === 'function') {
          const move = Engine.chooseBotMove(game, currentSeat);
          if (move && typeof game.applyMove === 'function') game.applyMove(move);
        }
        broadcastState();
        checkBotTurn();
      } catch (err) {
        console.error('Bot hatasi:', err.message);
      }
    }, 1000);
  }
}

io.on('connection', (socket) => {
  const seat = players.findIndex(p => p === null || p === 'BOT');
  if (seat !== -1) players[seat] = socket.id;

  socket.emit('joined', { seatIndex: seat, players });
  if (game) broadcastState();

  socket.on('startGame', () => startNewGame());

  socket.on('playerAction', (action) => {
    if (!game) return;
    try {
      if (action.type === 'drawStock' && game.drawFromStock) game.drawFromStock(action.seat);
      if (action.type === 'drawDiscard' && game.drawFromDiscard) game.drawFromDiscard(action.seat);
      if (action.type === 'discard' && game.discardTile) game.discardTile(action.seat, action.tileId);
      if (action.type === 'openHand' && game.openHand) game.openHand(action.seat, action.melds);
      broadcastState();
      checkBotTurn();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('disconnect', () => {
    const idx = players.indexOf(socket.id);
    if (idx !== -1) {
      players[idx] = 'BOT';
      broadcastState();
      checkBotTurn();
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Sunucu calisiyor:', PORT));
