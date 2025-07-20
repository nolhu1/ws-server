require('dotenv').config(); // Load .env
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
    socket.emit('lobbies', Object.keys(lobbies));
  });

  socket.on('createLobby', (lobbyId) => {
    if (!lobbies[lobbyId]) {
      lobbies[lobbyId] = { users: [], messages: [], currentQuestionIndex: 0 };
      io.emit('lobbies', Object.keys(lobbies));
    }
  });

  socket.on('joinLobby', ({ lobbyId, username }) => {
    socket.join(lobbyId);
    if (!lobbies[lobbyId]) return;

    lobbies[lobbyId].users.push(username);
    io.to(lobbyId).emit('chat', { sender: 'System', message: `${username} joined.` });
    io.to(lobbyId).emit('chat', { sender: 'System', message: "Type '@ai' to talk to the AI host!" });
  });

  socket.on("sendMessage", async ({ lobbyId, sender, message }) => {
    io.to(lobbyId).emit("chat", { sender, message });

    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    // Trivia answer check
    const currentQ = questions[lobby.currentQuestionIndex % questions.length];
    if (currentQ && message.toLowerCase().trim() === currentQ.a.toLowerCase()) {
      io.to(lobbyId).emit("chat", {
        sender: "Game",
        message: `🎉 ${sender} answered correctly!`,
      });
      lobby.currentQuestionIndex++;
    }

    // AI bot response
    if (sender !== "AI Bot" && message.toLowerCase().includes("@ai")) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content:
                "You are an energetic trivia game host. Keep responses short, fun, and lively. Engage the players and occasionally ask trivia questions.",
            },
            { role: "user", content: message },
          ],
        });
        const botReply = response.choices[0].message.content;
        io.to(lobbyId).emit("chat", { sender: "AI Bot", message: botReply });
      } catch (error) {
        console.error("OpenAI error:", error.message);
        io.to(lobbyId).emit("chat", {
          sender: "System",
          message: "⚠️ AI Bot failed to respond.",
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected:`, socket.id);
  });
});

// Trivia event loop every 25s
setInterval(() => {
  Object.entries(lobbies).forEach(([lobbyId, lobby]) => {
    if (lobby.users.length === 0) return;

    const qIndex = lobby.currentQuestionIndex % questions.length;
    const question = questions[qIndex];

    console.log(`[${new Date().toISOString()}] Trivia sent to ${lobbyId}: ${question.q}`);
    io.to(lobbyId).emit("chat", {
      sender: "Game",
      message: `🧠 Trivia: ${question.q}`,
    });
  });
}, 25000);

server.listen(3000, () =>
  console.log(`[${new Date().toISOString()}] WebSocket server running on port 3000`)
);
