const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));
app.use("/questions", express.static("questions"));

let timerInterval = null;


/* -----------------------------
DEFAULT STATE
------------------------------*/

function createDefaultState() {

  return {

    teamA: {
      name: "Team A",
      score: 0,
      strikes: 0,
      players: ["Player A1", "Player A2"],
      playerScores: [0, 0],
      fmScoreAdded: false
    },

    teamB: {
      name: "Team B",
      score: 0,
      strikes: 0,
      players: ["Player B1", "Player B2"],
      playerScores: [0, 0],
      fmScoreAdded: false
    },

    currentRound: "foff",
    currentSubRound: 1,
    currentQuestion: null,
    currentQuestionIndex: 0,
    revealedAnswers: [],
    allQuestions: [],
    timer: 0,
    timerRunning: false,
    showThankYou: false,
    activePlayer: "none"

  };

}

let gameState = createDefaultState();


/* -----------------------------
SAFE STATE BROADCAST
------------------------------*/

function getSafeState() {
  const { allQuestions, ...safeState } = gameState;
  return safeState;
}

/* -----------------------------
SOCKET CONNECTION
------------------------------*/

io.on("connection", (socket) => {

  console.log("Client connected:", socket.id);

  socket.emit("stateUpdate", getSafeState());

  /* FIX #6: Resync state on reconnect */
  socket.on("reconnect", () => {
    console.log("Client reconnected:", socket.id);
    socket.emit("stateUpdate", getSafeState());
  });


  /* -----------------------------
  QUESTION BROADCAST
  ------------------------------*/

  socket.on("broadcastCurrentQuestion", (questionData) => {

    gameState.currentQuestion = questionData;

    io.emit("broadcastCurrentQuestion", questionData);

  });


  /* -----------------------------
  ROUND CHANGE
  ------------------------------*/

  socket.on("roundChanged", (data) => {

    gameState.currentRound = data.round || "foff";

    io.emit("roundChanged", { round: gameState.currentRound });

  });


  /* -----------------------------
  TEAM UPDATE
  ------------------------------*/

  socket.on("updateTeams", (data) => {

    gameState.teamA.name = data.teamA || gameState.teamA.name;
    gameState.teamB.name = data.teamB || gameState.teamB.name;

    io.emit("stateUpdate", getSafeState());

    io.emit("teamUpdate", {
      teamA: gameState.teamA,
      teamB: gameState.teamB
    });

  });


  socket.on("updatePlayers", (data) => {

    gameState.teamA.players = data.playersA || gameState.teamA.players;
    gameState.teamB.players = data.playersB || gameState.teamB.players;

    io.emit("stateUpdate", getSafeState());

  });


  socket.on("setActivePlayer", (data) => {

    gameState.activePlayer = data.player || "none";

    io.emit("stateUpdate", getSafeState());

  });


  /* -----------------------------
  RESET GAME
  -----------------------------*/

  socket.on("resetGame", () => {

    /* FIX #1: CRITICAL - Clear timer interval before reset */
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    gameState = createDefaultState();

    io.emit("stateUpdate", getSafeState());

  });


  /* -----------------------------
  SCORE
  ------------------------------*/

  socket.on("addScore", (data) => {

    const teamKey = data.team === "A" ? "teamA" : "teamB";
    const team = gameState[teamKey];

    if (data.playerIndex !== undefined) {

      team.playerScores[data.playerIndex] += data.points;

      if (team.playerScores[data.playerIndex] < 0) {
        team.playerScores[data.playerIndex] = 0;
      }

    } else {

      team.score += data.points;

      if (team.score < 0) team.score = 0;

    }

    io.emit("stateUpdate", getSafeState());

    io.emit("scoreUpdate", {
      teamA: gameState.teamA.score,
      teamB: gameState.teamB.score
    });

  });


  socket.on("setScore", (data) => {

    const teamKey = data.team === "A" ? "teamA" : "teamB";

    gameState[teamKey].score = Math.max(0, data.score);

    io.emit("stateUpdate", getSafeState());

    io.emit("scoreUpdate", {
      teamA: gameState.teamA.score,
      teamB: gameState.teamB.score
    });

  });


  /* -----------------------------
  FAST MONEY TOTAL
  ------------------------------*/

  socket.on("revealTotal", (data) => {

    const team = data.team === "A" ? "teamA" : "teamB";
    const t = gameState[team];

    if (!t.fmScoreAdded) {

      t.score += t.playerScores[0] + t.playerScores[1];
      t.fmScoreAdded = true;

    }

    io.emit("stateUpdate", getSafeState());
    io.emit("revealTotal", data);

  });


  /* -----------------------------
  STRIKES
  ------------------------------*/

  socket.on("addStrike", (data) => {

    const team = data.team === "A" ? "teamA" : "teamB";

    gameState[team].strikes = Math.min(3, gameState[team].strikes + 1);

    io.emit("stateUpdate", getSafeState());

    io.emit("strikeUpdate", {
      teamA: gameState.teamA.strikes,
      teamB: gameState.teamB.strikes
    });

    io.emit("playBuzzer");

  });


  socket.on("resetStrikes", () => {

    gameState.teamA.strikes = 0;
    gameState.teamB.strikes = 0;

    io.emit("stateUpdate", getSafeState());

    io.emit("strikeUpdate", { teamA: 0, teamB: 0 });

  });


  /* -----------------------------
  LOAD QUESTIONS
  ------------------------------*/

  socket.on("loadQuestions", (data) => {

    gameState.allQuestions = data.questions || [];
    gameState.currentQuestionIndex = 0;
    gameState.currentQuestion = gameState.allQuestions[0] || null;
    gameState.revealedAnswers = [];

    io.emit("stateUpdate", getSafeState());

    if (gameState.currentQuestion) {
      io.emit("questionUpdate", gameState.currentQuestion);
    }

  });


  /* -----------------------------
  BOARD CONTROL
  ------------------------------*/

  socket.on("clearBoard", () => {

    gameState.revealedAnswers = [];
    io.emit("stateUpdate", getSafeState());

  });


  socket.on("markCross", () => {

    const maxAnswers = gameState.currentQuestion?.answers?.length || 8;

    if (gameState.revealedAnswers.length >= maxAnswers) return;

    const wrongAnswer = { answer: "❌", weight: 0 };

    gameState.revealedAnswers.push(wrongAnswer);

    io.emit("stateUpdate", getSafeState());

    io.emit("answerRevealed", {
      answer: wrongAnswer,
      team: gameState.activePlayer?.[0] || "A",
      playerIndex: 0
    });

  });


  socket.on("revealAnswer", (data) => {

    const answer = data.answer;

    if (!answer || !answer.answer) return;

    if (gameState.revealedAnswers.some(a => a.answer === answer.answer)) {
      return;
    }

    const crossIndex = gameState.revealedAnswers.findIndex(a => a.answer === "❌");
    if (crossIndex !== -1) {
      gameState.revealedAnswers[crossIndex] = answer;
    } else {
      gameState.revealedAnswers.push(answer);
    }

    const teamKey = data.team === "A" ? "teamA" : "teamB";

    if (data.playerIndex !== undefined) {

      gameState[teamKey].playerScores[data.playerIndex] += answer.weight;

    } else {

      gameState[teamKey].score += answer.weight;

    }

    io.emit("stateUpdate", getSafeState());

    io.emit("answerRevealed", data);

  });


  /* -----------------------------
  TIMER
  ------------------------------*/

  socket.on("startTimer", (data) => {

    if (timerInterval) {
      clearInterval(timerInterval);
    }

    gameState.timer = data.duration || 60;
    gameState.timerRunning = true;

    io.emit("timerUpdate", gameState.timer);

    timerInterval = setInterval(() => {

      gameState.timer--;

      if (gameState.timer <= 0) {

        gameState.timer = 0;
        clearInterval(timerInterval);
        timerInterval = null;
        gameState.timerRunning = false;

        io.emit("timerUpdate", 0);
        io.emit("timerFinished");

        return;

      }

      io.emit("timerUpdate", gameState.timer);

    }, 1000);

  });


  socket.on("stopTimer", () => {

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    gameState.timerRunning = false;

  });


  socket.on("resetTimer", () => {

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    gameState.timer = 0;
    gameState.timerRunning = false;

    io.emit("timerUpdate", 0);

  });


  /* -----------------------------
  SCREENS
  ------------------------------*/

  socket.on("showThankYou", () => {

    gameState.showThankYou = true;

    io.emit("showThankYouScreen", true);

  });


  socket.on("hideThankYou", () => {

    gameState.showThankYou = false;

    io.emit("showThankYouScreen", false);

  });


  socket.on("showTeamScore", (data) => {

    const team = data.team === "A" ? "teamA" : "teamB";
    const t = gameState[team];

    io.emit("showTeamScoreScreen", {
      team: data.team,
      name: t.name,
      score: t.score,
      playerScores: t.playerScores,
      players: t.players
    });

  });


  socket.on("checkFmWin", () => {

    const combined =
      gameState.teamA.playerScores[0] +
      gameState.teamA.playerScores[1];

    const won = combined >= 200;

    io.emit("showWinnerScreen", {
      winner: won ? "A" : "none",
      teamAName: gameState.teamA.name,
      teamAScore: combined,
      combined: combined,
      target: 200,
      won: won
    });

  });


  socket.on("hideRevealScreen", () => {

    io.emit("hideRevealScreen");

  });


  socket.on("disconnect", () => {

    console.log("Client disconnected:", socket.id);

  });

});


/* -----------------------------
SERVER START
------------------------------*/

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {

  console.log(`Game Show Server running on http://localhost:${PORT}`);

});