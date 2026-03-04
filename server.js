const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static('public'));
app.use('/questions', express.static('questions'));

// Global Game State
let gameState = {
  teamA: {
    name: 'Team A',
    score: 0,
    strikes: 0,
    players: ['Player A1', 'Player A2'],
    playerScores: [0, 0]
  },
  teamB: {
    name: 'Team B',
    score: 0,
    strikes: 0,
    players: ['Player B1', 'Player B2'],
    playerScores: [0, 0]
  },
  currentRound: 'foff', // 'foff' or 'fm'
  currentSubRound: 1,
  currentQuestion: null,
  currentQuestionIndex: 0,
  revealedAnswers: [],
  allQuestions: [],
  timer: 0,
  timerRunning: false,
  showThankYou: false,
  activePlayer: 'none'
};

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current state to new client
  socket.emit('stateUpdate', gameState);

  // TEAM MANAGEMENT
  socket.on('updateTeams', (data) => {
    gameState.teamA.name = data.teamA || gameState.teamA.name;
    gameState.teamB.name = data.teamB || gameState.teamB.name;
    io.emit('stateUpdate', gameState);
    io.emit('teamUpdate', { teamA: gameState.teamA, teamB: gameState.teamB });
  });

  socket.on('updatePlayers', (data) => {
    gameState.teamA.players = data.playersA || gameState.teamA.players;
    gameState.teamB.players = data.playersB || gameState.teamB.players;
    io.emit('stateUpdate', gameState);
  });

  socket.on('setActivePlayer', (data) => {
    gameState.activePlayer = data.player; // 'A1', 'A2', 'B1', 'B2', or 'none'
    io.emit('stateUpdate', gameState);
  });

  socket.on('resetGame', () => {
    gameState = {
      ...gameState,
      teamA: { name: '', score: 0, strikes: 0, players: ['', ''], playerScores: [0, 0], fmScoreAdded: false },
      teamB: { name: '', score: 0, strikes: 0, players: ['', ''], playerScores: [0, 0], fmScoreAdded: false },
      revealedAnswers: [],
      currentQuestionIndex: 0,
      currentRound: 'foff',
      currentSubRound: 1,
      showThankYou: false,
      activePlayer: 'none'
    };
    io.emit('stateUpdate', gameState);
  });

  // SCORE MANAGEMENT
  socket.on('addScore', (data) => {
    if (data.team === 'A') {
      if (data.playerIndex !== undefined) {
        gameState.teamA.playerScores[data.playerIndex] += data.points;
      } else {
        gameState.teamA.score += data.points;
      }
    } else {
      if (data.playerIndex !== undefined) {
        gameState.teamB.playerScores[data.playerIndex] += data.points;
      } else {
        gameState.teamB.score += data.points;
      }
    }
    io.emit('stateUpdate', gameState);
    io.emit('scoreUpdate', { teamA: gameState.teamA.score, teamB: gameState.teamB.score });
  });

  socket.on('setScore', (data) => {
    if (data.team === 'A') {
      gameState.teamA.score = Math.max(0, data.score);
    } else {
      gameState.teamB.score = Math.max(0, data.score);
    }
    io.emit('stateUpdate', gameState);
    io.emit('scoreUpdate', { teamA: gameState.teamA.score, teamB: gameState.teamB.score });
  });

  socket.on('revealTotal', (data) => {
    const team = data.team;
    if (team === 'A' && !gameState.teamA.fmScoreAdded) {
      gameState.teamA.score += gameState.teamA.playerScores[0] + gameState.teamA.playerScores[1];
      gameState.teamA.fmScoreAdded = true;
    } else if (team === 'B' && !gameState.teamB.fmScoreAdded) {
      gameState.teamB.score += gameState.teamB.playerScores[0] + gameState.teamB.playerScores[1];
      gameState.teamB.fmScoreAdded = true;
    }
    io.emit('stateUpdate', gameState);
    io.emit('revealTotal', data);
  });

  // STRIKE MANAGEMENT
  socket.on('addStrike', (data) => {
    if (data.team === 'A') {
      gameState.teamA.strikes++;
    } else if (data.team === 'B') {
      gameState.teamB.strikes++;
    }
    io.emit('stateUpdate', gameState);
    io.emit('strikeUpdate', { teamA: gameState.teamA.strikes, teamB: gameState.teamB.strikes });
    io.emit('playBuzzer');
  });

  socket.on('resetStrikes', () => {
    gameState.teamA.strikes = 0;
    gameState.teamB.strikes = 0;
    io.emit('stateUpdate', gameState);
    io.emit('strikeUpdate', { teamA: 0, teamB: 0 });
  });

  socket.on('resetStrike', (data) => {
    if (data.team === 'A') {
      gameState.teamA.strikes = 0;
    } else {
      gameState.teamB.strikes = 0;
    }
    io.emit('stateUpdate', gameState);
    io.emit('strikeUpdate', { teamA: gameState.teamA.strikes, teamB: gameState.teamB.strikes });
  });

  // QUESTION MANAGEMENT
  socket.on('loadQuestions', (data) => {
    gameState.allQuestions = data.questions;
    gameState.currentQuestionIndex = 0;
    gameState.currentQuestion = gameState.allQuestions[0];
    gameState.revealedAnswers = [];
    io.emit('stateUpdate', gameState);
    io.emit('questionUpdate', gameState.currentQuestion);
  });

  socket.on('nextQuestion', () => {
    if (gameState.currentQuestionIndex < gameState.allQuestions.length - 1) {
      gameState.currentQuestionIndex++;
      gameState.currentQuestion = gameState.allQuestions[gameState.currentQuestionIndex];
      gameState.teamA.strikes = 0;
      gameState.teamB.strikes = 0;
      io.emit('stateUpdate', gameState);
      io.emit('questionUpdate', gameState.currentQuestion);
      io.emit('strikeUpdate', { teamA: 0, teamB: 0 });
    }
  });

  socket.on('previousQuestion', () => {
    if (gameState.currentQuestionIndex > 0) {
      gameState.currentQuestionIndex--;
      gameState.currentQuestion = gameState.allQuestions[gameState.currentQuestionIndex];
      gameState.teamA.strikes = 0;
      gameState.teamB.strikes = 0;
      io.emit('stateUpdate', gameState);
      io.emit('questionUpdate', gameState.currentQuestion);
      io.emit('strikeUpdate', { teamA: 0, teamB: 0 });
    }
  });

  socket.on('clearBoard', () => {
    gameState.revealedAnswers = [];
    io.emit('stateUpdate', gameState);
  });

  socket.on('markCross', () => {
    // Allows the Host to inject an "❌" answer block for passes/wrong answers
    if (gameState.revealedAnswers.length < 8) {
      const wrongAnswer = { answer: "❌", weight: 0 };
      gameState.revealedAnswers.push(wrongAnswer);
      io.emit('stateUpdate', gameState);
      io.emit('answerRevealed', { answer: wrongAnswer, team: gameState.activePlayer ? gameState.activePlayer[0] : 'A', playerIndex: 0 });
    }
  });

  socket.on('revealAnswer', (data) => {
    const answer = data.answer;
    const team = data.team; // 'A' or 'B'
    const playerIndex = data.playerIndex; // 0 or 1

    if (!gameState.revealedAnswers.find(a => a.answer === answer.answer)) {
      gameState.revealedAnswers.push(answer);

      if (playerIndex !== undefined) {
        gameState[team === 'A' ? 'teamA' : 'teamB'].playerScores[playerIndex] += answer.weight;
      } else {
        gameState[team === 'A' ? 'teamA' : 'teamB'].score += answer.weight;
      }

      io.emit('stateUpdate', gameState);
      io.emit('answerRevealed', { answer, team, playerIndex });
    }
  });

  // TIMER MANAGEMENT
  socket.on('startTimer', (data) => {
    gameState.timer = data.duration || 60;
    gameState.timerRunning = true;

    const timerInterval = setInterval(() => {
      gameState.timer--;
      io.emit('timerUpdate', gameState.timer);

      if (gameState.timer <= 0) {
        clearInterval(timerInterval);
        gameState.timerRunning = false;
        io.emit('timerFinished');
      }
    }, 1000);

    io.emit('timerUpdate', gameState.timer);
  });

  socket.on('stopTimer', () => {
    gameState.timerRunning = false;
    io.emit('timerStopped');
  });

  socket.on('resetTimer', () => {
    gameState.timer = 0;
    gameState.timerRunning = false;
    io.emit('timerUpdate', 0);
  });

  socket.on('setTimer', (data) => {
    gameState.timer = data.duration || 60;
    io.emit('timerUpdate', gameState.timer);
  });

  // THANK YOU SCREEN
  socket.on('showThankYou', () => {
    gameState.showThankYou = true;
    io.emit('showThankYouScreen', true);
  });

  socket.on('hideThankYou', () => {
    gameState.showThankYou = false;
    io.emit('showThankYouScreen', false);
  });

  // FM END-GAME REVEAL SEQUENCE
  socket.on('showTeamScore', (data) => {
    const team = data.team;
    const teamData = team === 'A' ? gameState.teamA : gameState.teamB;
    io.emit('showTeamScoreScreen', {
      team,
      name: teamData.name,
      score: teamData.score,
      playerScores: teamData.playerScores,
      players: teamData.players
    });
  });

  socket.on('showWinner', () => {
    const a = gameState.teamA.score;
    const b = gameState.teamB.score;
    const winner = a > b ? 'A' : b > a ? 'B' : 'tie';
    io.emit('showWinnerScreen', {
      winner,
      teamAName: gameState.teamA.name,
      teamBName: gameState.teamB.name,
      teamAScore: gameState.teamA.score,
      teamBScore: gameState.teamB.score
    });
  });

  socket.on('hideRevealScreen', () => {
    io.emit('hideRevealScreen');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Game Show Server running on http://localhost:${PORT}`);
});