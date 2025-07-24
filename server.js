//require('dotenv').config();
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Lobby state
let lobbies = {}; 
// { lobbyId: { users: [], messages: [], currentQuestionIndex: 0, maxHumans: number, maxBots: number, isPrivate: boolean } }

// To track socket -> { lobbyId, username }
const socketLobbyMap = new Map();

const questions = [
  { q: "What is the capital of France?", a: "paris" },
  { q: "What is 2 + 2?", a: "4" },
  { q: "What color do you get by mixing red and white?", a: "pink" },
  { q: "How many legs does a spider have?", a: "8" },
  { q: "Which planet is known as the Red Planet?", a: "mars" },
  { q: "What gas do humans need to breathe?", a: "oxygen" },
  { q: "Which animal is known as the king of the jungle?", a: "lion" },
  { q: "What’s the tallest animal on Earth?", a: "giraffe" },
  { q: "How many days are in a leap year?", a: "366" },
  { q: "What do bees produce?", a: "honey" },
];

// Define bots with personas and system prompts
const bots = {
  triviaMaster: {
    name: "triviaMaster",
    displayName: "TriviaMaster Bot",
    systemPrompt: "You are TriviaMaster, a witty and challenging trivia host who loves fun facts and riddles. Keep answers concise and playful.",
  },
  friendlyHelper: {
    name: "friendlyHelper",
    displayName: "FriendlyHelper Bot",
    systemPrompt: "You are FriendlyHelper, a kind and helpful assistant who always encourages players and gives positive feedback. Use a warm tone.",
  },
  sarcasticBot: {
    name: "sarcasticBot",
    displayName: "SarcasticBot",
    systemPrompt: "You are SarcasticBot, a sassy and sarcastic bot who gives humorous, slightly cheeky replies but never offensive.",
  },
};

// Track spawned bots per lobby (lobbyId -> array of bot names)
const spawnedBots = {};

// Helper to get current bot count in a lobby
function getBotCount(lobbyId) {
  return (spawnedBots[lobbyId] || []).length;
}

// Helper to spawn a bot in a lobby if below limit
function spawnBot(lobbyId, botName) {
  if (!lobbies[lobbyId]) return { success: false, message: "Lobby not found." };
  if (!bots[botName]) return { success: false, message: `Bot ${botName} does not exist.` };

  spawnedBots[lobbyId] = spawnedBots[lobbyId] || [];
  const currentCount = spawnedBots[lobbyId].length;
  if (currentCount >= lobbies[lobbyId].maxBots) {
    return { success: false, message: "❌ AI seat limit reached in this lobby." };
  }
  if (spawnedBots[lobbyId].includes(botName)) {
    return { success: false, message: `${bots[botName].displayName} is already spawned.` };
  }
  spawnedBots[lobbyId].push(botName);
  return { success: true, message: `${bots[botName].displayName} spawned!` };
}

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected:`, socket.id);

  socket.on('getLobbies', () => {
    const summary = Object.entries(lobbies).map(([id, lobby]) => ({
      id,
      users: lobby.users.length,
      maxHumans: lobby.maxHumans,
      isPrivate: lobby.isPrivate,
    }));
    socket.emit('lobbies', summary);
  });

  socket.on('createLobby', ({ lobbyId, maxHumans = 5, maxBots = 1, isPrivate = false }) => {
    if (!lobbies[lobbyId]) {
      lobbies[lobbyId] = {
        users: [],
        messages: [],
        currentQuestionIndex: 0,
        maxHumans,
        maxBots,
        isPrivate,
      };
      console.log(`[${new Date().toISOString()}] Lobby created:`, lobbyId);
      io.emit('lobbies', Object.entries(lobbies).map(([id, lobby]) => ({
        id,
        users: lobby.users.length,
        maxHumans: lobby.maxHumans,
        isPrivate: lobby.isPrivate,
      })));
    }
  });

socket.on('joinLobby', ({ lobbyId, username }) => {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  // If user is already in the lobby, don't add again
  if (lobby.users.includes(username)) {
    // Still join the socket to the room if not already joined
    socket.join(lobbyId);
    socketLobbyMap.set(socket.id, { lobbyId, username });

    // Optionally send a message just acknowledging rejoin or do nothing
    socket.emit("chat", {
      sender: "System",
      message: `You have rejoined the lobby. Current bots present: ${spawnedBots[lobbyId] ? spawnedBots[lobbyId].join(", ") : "None"}`,
    });

    return;
  }

  if (lobby.users.length >= lobby.maxHumans) {
    socket.emit("chat", {
      sender: "System",
      message: "❌ Lobby is full.",
    });
    return;
  }

  socket.join(lobbyId);
  lobby.users.push(username);
  socketLobbyMap.set(socket.id, { lobbyId, username });

  spawnedBots[lobbyId] = spawnedBots[lobbyId] || [];

  io.to(lobbyId).emit('chat', { sender: 'System', message: `${username} joined.` });
  io.to(lobbyId).emit('chat', { sender: 'System', message: "Type '@bot_name' to talk to a bot or 'spawn @bot_name' to add a bot (if seats available)!\nList of available bots: " + Object.keys(bots).map(b => bots[b].displayName).join(", ") });

  io.emit('lobbies', Object.entries(lobbies).map(([id, l]) => ({
    id,
    users: l.users.length,
    maxHumans: l.maxHumans,
    isPrivate: l.isPrivate,
  })));
});


  socket.on("sendMessage", async ({ lobbyId, sender, message }) => {
    io.to(lobbyId).emit("chat", { sender, message });

    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    // Check spawn command: "spawn @bot_name" or "spawn bot_name"
    const spawnMatch = message.match(/^spawn\s+@?(\w+)/i);
    if (spawnMatch) {
      let inputName = spawnMatch[1].toLowerCase();
      // Find the actual bot key (case-insensitive)
      const botKey = Object.keys(bots).find(
        key => key.toLowerCase() === inputName
      );
      if (!botKey) {
        io.to(lobbyId).emit("chat", {
          sender: "System",
          message: `Bot ${inputName} does not exist.`,
        });
        return;
      }
      const spawnResult = spawnBot(lobbyId, botKey);
      io.to(lobbyId).emit("chat", {
        sender: "System",
        message: spawnResult.message,
      });
      return;
    }

    // Trivia check
    const currentQ = questions[lobby.currentQuestionIndex % questions.length];
    if (currentQ && message.toLowerCase().trim() === currentQ.a.toLowerCase()) {
      io.to(lobbyId).emit("chat", {
        sender: "Game",
        message: `🎉 ${sender} answered correctly!`,
      });
      lobby.currentQuestionIndex++;
    }

    // Handle AI bot responses if message contains @bot_name of a spawned bot
const mentionedBots = Object.keys(bots).filter(botName =>
  message.toLowerCase().includes("@" + botName.toLowerCase())
);

const activeBots = spawnedBots[lobbyId] || [];
const botsToRespond = mentionedBots.filter(botName => activeBots.includes(botName));

if (botsToRespond.length > 0 && sender !== "AI Bot") {
  const botName = botsToRespond[0];
  const bot = bots[botName];

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: bot.systemPrompt },
        { role: "user", content: message },
      ],
      stream: true,
    });

    let firstChunk = true;

    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content;
      if (!token) continue;

      // Emit chunks incrementally as aiChunk
      io.to(lobbyId).emit("aiChunk", { sender: bot.displayName, content: token });

      // Optional: Emit a synthetic "chat" message only on the first chunk to initialize UI
      if (firstChunk) {
        firstChunk = false;
        io.to(lobbyId).emit("chat", { sender: bot.displayName, message: "" });
      }
    }

    // Signal end of stream
    io.to(lobbyId).emit("aiEnd", { sender: bot.displayName });

  } catch (error) {
    console.error(`OpenAI stream error for ${botName}:`, error.message);
    io.to(lobbyId).emit("chat", {
      sender: "System",
      message: `⚠️ ${bot.displayName} failed to respond.`,
    });
  }

  return; // Prevent sending trivia message twice
}

  });

  socket.on('disconnect', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected:`, socket.id);

    const info = socketLobbyMap.get(socket.id);
    if (!info) return;

    const { lobbyId, username } = info;
    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    // Remove user from lobby users array
    lobby.users = lobby.users.filter(u => u !== username);
    socketLobbyMap.delete(socket.id);

    io.to(lobbyId).emit('chat', { sender: 'System', message: `${username} left.` });

    // Broadcast updated lobby list with user counts
    io.emit('lobbies', Object.entries(lobbies).map(([id, l]) => ({
      id,
      users: l.users.length,
      maxHumans: l.maxHumans,
      isPrivate: l.isPrivate,
    })));
  });
});

// Game event loop
setInterval(() => {
  Object.entries(lobbies).forEach(([lobbyId, lobby]) => {
    if (lobby.users.length === 0) return;
    const qIndex = lobby.currentQuestionIndex % questions.length;
    const question = questions[qIndex];

    io.to(lobbyId).emit("chat", {
      sender: "Game",
      message: `🧠 Trivia: ${question.q}`,
    });
  });
}, 25000);

server.listen(3000, () =>
  console.log(`[${new Date().toISOString()}] WebSocket server running on port 3000`)
);
