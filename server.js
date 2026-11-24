import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import {
  Okey101Hand,
  botStep,
  colorOf,
  numberOf,
  isFake,
  isOkey
} from './src/index.js';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.get('/', (req, res) => {
  res.send('101 Okey Sunucusu Aktif ve Motor Bagli!');
});

let game = null;
let players = [null, null, null, null];

// Taş ID'lerini arayüzün okuyabileceği renk ve sayı formatına çevirir
function serializeTile(tileId, indicatorTile) {
  if (tileId === null || tileId === undefined) return null;
  return {
    id: tileId,
    color: colorOf(tileId),
    value: isFake(tileId) ? 'Sahte' : numberOf(tileId),
    isFake: isFake(tileId),
    isOkey: indicatorTile !== undefined ? isOkey(tileId, indicatorTile) : false
  };
}

function startNewGame() {
  game = new Okey101Hand();
  if (typeof game.deal === 'function') game.deal();
  broadcastState();
  checkBotTurn();
}

function broadcastState() {
  if (!game) return;
  const indicator = game.indicator ?? game.gosterge;

  players.forEach((socketId, seatIndex) => {
    if (socketId && socketId !== 'BOT') {
      const rawHand = game.hands?.[seatIndex] || [];
      const myHand = rawHand.map(t => serializeTile(t, indicator));
      
      // Yandan atılan son taşı bul
      const discards = game.discards?.[seatIndex === 0 ? 3 : seatIndex - 1] || [];
      const lastDiscard = discards.length > 0 ? serializeTile(discards[discards.length - 1], indicator) : null;

      io.to(socketId).emit('gameState', {
        seatIndex,
        players,
        currentTurn: game.turn ?? game.currentSeat ?? 0,
        myHand,
        lastDiscard,
        melds: game.melds || game.tableMelds || []
      });
    }
  });
}

function checkBotTurn() {
  if (!game || game.finished || game.isFinished) return;
  const currentSeat = game.turn ?? game.currentSeat ?? 0;

  if (players[currentSeat] === 'BOT' || players[currentSeat] === null) {
    setTimeout(() => {
      try {
        botStep(game);
        broadcastState();
        checkBotTurn();
      } catch (err) {
        console.error('Bot adim hatasi:', err.message);
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
      if (action.type === 'drawStock' && typeof game.draw === 'function') game.draw(action.seat);
      if (action.type === 'drawDiscard' && typeof game.takeDiscard === 'function') game.takeDiscard(action.seat);
      if (action.type === 'discard' && typeof game.discard === 'function') game.discard(action.seat, action.tileId);
      if (action.type === 'openHand' && typeof game.open === 'function') game.open(action.seat);

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
