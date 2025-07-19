const { OpenAI } = require("openai");
//require('dotenv').config();
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
let lobbies = {}; // { lobbyId: { users: [], messages: [], currentQuestionIndex: 0 } }

// Trivia questions
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

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected:`, socket.id);

  socket.on('getLobbies', () => {
    console.log(`[${new Date().toISOString()}] getLobbies requested by ${socket.id}`);
    socket.emit('lobbies', Object.keys(lobbies));
  });

  socket.on('createLobby', (lobbyId) => {
    console.log(`[${new Date().toISOString()}] Received createLobby:`, lobbyId);
    if (!lobbies[lobbyId]) {
      lobbies[lobbyId] = { users: [], messages: [], currentQuestionIndex: 0 };
      console.log(`[${new Date().toISOString()}] Lobby created:`, lobbyId);
      io.emit('lobbies', Object.keys(lobbies));
    } else {
      console.log(`[${new Date().toISOString()}] Lobby already exists:`, lobbyId);
    }
  });

  socket.on('joinLobby', ({ lobbyId, username }) => {
    console.log(`[${new Date().toISOString()}] User ${username} joining lobby:`, lobbyId);
    socket.join(lobbyId);

    if (!lobbies[lobbyId]) {
      console.warn(`[${new Date().toISOString()}] joinLobby failed: Lobby does not exist:`, lobbyId);
      return;
    }

    lobbies[lobbyId].users.push(username);
    console.log(`[${new Date().toISOString()}] Users in ${lobbyId}:`, lobbies[lobbyId].users);
    io.to(lobbyId).emit('chat', { sender: 'System', message: `${username} joined.` });
    io.to(lobbyId).emit('chat', { sender: 'System', message: "Include @ai in message to communicate with AI bot" });
  });

  socket.on("sendMessage", async ({ lobbyId, sender, message }) => {
    console.log(`[${new Date().toISOString()}] Message from ${sender} in lobby ${lobbyId}:`, message);
    io.to(lobbyId).emit("chat", { sender, message });

    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    const currentQ = questions[lobby.currentQuestionIndex];
    if (currentQ && message.toLowerCase() == (currentQ.a)) {
      io.to(lobbyId).emit("chat", { 
        sender: "Game",
        message: `🎉 ${sender} answered correctly! The next game event will commence soon.`,        
      });
      lobby.currentQuestionIndex++;
    }

    if (sender !== "AI Bot" && message.toLowerCase().includes("@ai")) {
      try {
        console.log(`[${new Date().toISOString()}] Sending to OpenAI API...`);
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: message }],
        });
        const botReply = response.choices[0].message.content;
        console.log(`[${new Date().toISOString()}] OpenAI replied:`, botReply);

        io.to(lobbyId).emit("chat", { sender: "AI Bot", message: botReply });
      } catch (error) {
        console.error(`[${new Date().toISOString()}] OpenAI API error:`, error);
        io.to(lobbyId).emit("chat", { sender: "System", message: "AI Bot failed to respond." });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected:`, socket.id);
  });
});

// Inject game events (trivia) every 30 seconds
setInterval(() => {
  Object.entries(lobbies).forEach(([lobbyId, lobby]) => {
    if (lobby.users.length === 0) return;

    const qIndex = lobby.currentQuestionIndex % questions.length;
    const question = questions[qIndex];

    console.log(`[${new Date().toISOString()}] Sending trivia to ${lobbyId}: ${question.q}`);

    io.to(lobbyId).emit("chat", {
      sender: "Game",
      message: `Trivia: ${question.q}`,
    });
  });
}, 25000); // 25 seconds

server.listen(3000, () =>
  console.log(`[${new Date().toISOString()}] WebSocket server running on port 3000`)
);
