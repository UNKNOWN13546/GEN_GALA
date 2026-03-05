const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);

/* -----------------------------
SUPABASE CONFIG
------------------------------*/
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Stricter check to avoid crashes on invalid strings
const isSupabaseConfigured =
  typeof supabaseUrl === 'string' &&
  supabaseUrl.startsWith('http') &&
  typeof supabaseKey === 'string' &&
  supabaseKey.length > 20;

let supabase = null;
if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`📡 Supabase client initialized (URL starts with: ${supabaseUrl.substring(0, 10)}...)`);
  } catch (err) {
    console.error("❌ Failed to initialize Supabase client:", err.message);
    isSupabaseConfigured = false; // Disable persistence if client creation fails
  }
} else {
  console.warn("⚠️ Supabase not configured correctly. Data will NOT be saved to cloud.");
  console.log(`🔍 Debug Info - URL present: ${!!supabaseUrl}, Key present: ${!!supabaseKey}`);
}

const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));
app.use("/questions", express.static("questions"));

// Health check for deployment
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

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
    activePlayer: "none",

    /* GLOBAL TEAMS */
    globalTeams: []

  };

}

let gameState = createDefaultState();


/* -----------------------------
SUPABASE SYNC HELPERS
------------------------------*/
async function loadTeamsFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('score', { ascending: false });

    if (error) throw error;
    if (data) {
      gameState.globalTeams = data;
      console.log(`✅ Loaded ${data.length} teams from Supabase`);
      io.emit("stateUpdate", getSafeState());
    }
  } catch (err) {
    console.error("❌ Error loading teams from Supabase:", err.message);
  }
}

async function syncTeamToSupabase(team) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('teams')
      .upsert({
        name: team.name,
        players: team.players,
        score: team.score
      }, { onConflict: 'name' });

    if (error) throw error;
  } catch (err) {
    console.error(`❌ Error syncing team ${team.name} to Supabase:`, err.message);
  }
}

async function removeTeamFromSupabase(teamName) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('teams')
      .delete()
      .eq('name', teamName);

    if (error) throw error;
  } catch (err) {
    console.error(`❌ Error removing team ${teamName} from Supabase:`, err.message);
  }
}

async function saveSessionState() {
  if (!supabase) return;
  try {
    // We exclude transient data like the timer and questions themselves (to keep JSON small)
    // but keep indices and revealed state.
    const persistentState = {
      teamA: gameState.teamA,
      teamB: gameState.teamB,
      currentRound: gameState.currentRound,
      currentSubRound: gameState.currentSubRound,
      currentQuestionIndex: gameState.currentQuestionIndex,
      revealedAnswers: gameState.revealedAnswers,
      activePlayer: gameState.activePlayer,
      showThankYou: gameState.showThankYou
    };

    const { error } = await supabase
      .from('session_state')
      .upsert({ id: 1, data: persistentState });

    if (error) throw error;
  } catch (err) {
    console.error("❌ Error saving session state to Supabase:", err.message);
  }
}

async function loadSessionState() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('session_state')
      .select('data')
      .eq('id', 1)
      .single();

    if (error) throw error;
    if (data && data.data && Object.keys(data.data).length > 0) {
      const saved = data.data;
      gameState.teamA = saved.teamA || gameState.teamA;
      gameState.teamB = saved.teamB || gameState.teamB;
      gameState.currentRound = saved.currentRound || gameState.currentRound;
      gameState.currentSubRound = saved.currentSubRound || gameState.currentSubRound;
      gameState.currentQuestionIndex = saved.currentQuestionIndex || gameState.currentQuestionIndex;
      gameState.revealedAnswers = saved.revealedAnswers || gameState.revealedAnswers;
      gameState.activePlayer = saved.activePlayer || gameState.activePlayer;
      gameState.showThankYou = saved.showThankYou || gameState.showThankYou;

      console.log("✅ Session state restored from Supabase");
    }
  } catch (err) {
    if (err.code !== 'PGRST116') { // Ignore "no rows found" on first run
      console.error("❌ Error loading session state from Supabase:", err.message);
    }
  }
}

function broadcastSupabaseStatus() {
  io.emit("supabaseStatus", {
    configured: isSupabaseConfigured,
    connected: !!supabase
  });
}

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

  /* Load teams and session from Supabase on initial connection */
  (async () => {
    try {
      await loadTeamsFromSupabase();
      await loadSessionState();
    } catch (e) {
      console.error("⚠️ Startup data fetch failed:", e.message);
    }
    io.emit("stateUpdate", getSafeState());
    broadcastSupabaseStatus();
  })();


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
    saveSessionState();
  });


  /* -----------------------------
  TEAM UPDATE
  ------------------------------*/

  socket.on("updateTeams", (data) => {

    gameState.teamA.name = data.teamA || gameState.teamA.name;
    gameState.teamB.name = data.teamB || gameState.teamB.name;

    /* Create them in global pool if they don't exist under update hook */
    if (!gameState.globalTeams.some(t => t.name === gameState.teamA.name)) {
      const newTeam = { name: gameState.teamA.name, score: 0, players: [] };
      gameState.globalTeams.push(newTeam);
      syncTeamToSupabase(newTeam);
    }
    if (!gameState.globalTeams.some(t => t.name === gameState.teamB.name)) {
      const newTeam = { name: gameState.teamB.name, score: 0, players: [] };
      gameState.globalTeams.push(newTeam);
      syncTeamToSupabase(newTeam);
    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();

    io.emit("teamUpdate", {
      teamA: gameState.teamA,
      teamB: gameState.teamB
    });

  });

  socket.on("registerTeams", (data) => {
    /* Hard overwrite from JSON or Bulk Loading */
    if (Array.isArray(data.teams)) {
      gameState.globalTeams = data.teams;
      io.emit("stateUpdate", getSafeState());
      // Sync all registered teams to Supabase
      data.teams.forEach(team => syncTeamToSupabase(team));
    }
    saveSessionState();
  });

  socket.on("registerTeam", (teamObj) => {
    if (!teamObj || !teamObj.name) return;

    let existingIndex = gameState.globalTeams.findIndex(t => t.name === teamObj.name);
    if (existingIndex >= 0) {
      gameState.globalTeams[existingIndex] = { ...gameState.globalTeams[existingIndex], ...teamObj };
    } else {
      gameState.globalTeams.push({ name: teamObj.name, score: teamObj.score || 0, players: teamObj.players || [] });
    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();

    /* Sync to DB */
    syncTeamToSupabase(teamObj);
  });

  socket.on("removeTeam", (data) => {
    if (!data.name) return;
    gameState.globalTeams = gameState.globalTeams.filter(t => t.name !== data.name);
    io.emit("stateUpdate", getSafeState());
    saveSessionState();

    /* Sync to DB */
    removeTeamFromSupabase(data.name);
  });

  socket.on("setMatchup", (data) => {
    /* Switch the active playing teams */
    const teamA = gameState.globalTeams.find(t => t.name === data.teamA);
    const teamB = gameState.globalTeams.find(t => t.name === data.teamB);

    if (teamA) {
      gameState.teamA.name = teamA.name;
      gameState.teamA.score = teamA.score || 0;
      gameState.teamA.players = teamA.players.length ? [...teamA.players] : ["Player A1", "Player A2"];
      gameState.teamA.playerScores = [0, 0];
      gameState.teamA.fmScoreAdded = false;
      gameState.teamA.strikes = 0;
    }

    if (teamB) {
      gameState.teamB.name = teamB.name;
      gameState.teamB.score = teamB.score || 0;
      gameState.teamB.players = teamB.players.length ? [...teamB.players] : ["Player B1", "Player B2"];
      gameState.teamB.playerScores = [0, 0];
      gameState.teamB.fmScoreAdded = false;
      gameState.teamB.strikes = 0;
    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();
  });


  socket.on("updatePlayers", (data) => {

    gameState.teamA.players = data.playersA || gameState.teamA.players;
    gameState.teamB.players = data.playersB || gameState.teamB.players;

    // Update global teams with new player lists
    const globalTeamA = gameState.globalTeams.find(t => t.name === gameState.teamA.name);
    if (globalTeamA) {
      globalTeamA.players = gameState.teamA.players;
      syncTeamToSupabase(globalTeamA);
    }
    const globalTeamB = gameState.globalTeams.find(t => t.name === gameState.teamB.name);
    if (globalTeamB) {
      globalTeamB.players = gameState.teamB.players;
      syncTeamToSupabase(globalTeamB);
    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();

  });


  socket.on("setActivePlayer", (data) => {

    gameState.activePlayer = data.player || "none";

    io.emit("stateUpdate", getSafeState());
    saveSessionState();

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

    /* Clear persistence */
    saveSessionState();
  });


  /* -----------------------------
  SCORE
  ------------------------------*/

  socket.on("addScore", (data) => {

    const teamKey = data.team === "A" ? "teamA" : "teamB";
    const team = gameState[teamKey];

    let pointsAdded = 0;

    if (data.playerIndex !== undefined) {

      team.playerScores[data.playerIndex] += data.points;

      if (team.playerScores[data.playerIndex] < 0) {
        team.playerScores[data.playerIndex] = 0;
      }

    } else {

      pointsAdded = data.points;
      team.score += data.points;

      if (team.score < 0) team.score = 0;

    }

    /* Update Global Leaderboard Record */
    const globalT = gameState.globalTeams.find(t => t.name === team.name);
    if (globalT && pointsAdded !== 0) {
      globalT.score = (globalT.score || 0) + pointsAdded;
      if (globalT.score < 0) globalT.score = 0;

      /* Sync to DB */
      syncTeamToSupabase(globalT);
    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();

    io.emit("scoreUpdate", {
      teamA: gameState.teamA.score,
      teamB: gameState.teamB.score
    });
  });


  socket.on("setScore", (data) => {

    const teamKey = data.team === "A" ? "teamA" : "teamB";
    const oldScore = gameState[teamKey].score;

    gameState[teamKey].score = Math.max(0, data.score);

    /* Update Global Leaderboard */
    const delta = gameState[teamKey].score - oldScore;
    const globalT = gameState.globalTeams.find(t => t.name === gameState[teamKey].name);
    if (globalT) {
      globalT.score += delta;
      if (globalT.score < 0) globalT.score = 0;
    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();

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

      const pointsCombined = t.playerScores[0] + t.playerScores[1];
      t.score += pointsCombined;
      t.fmScoreAdded = true;

      /* GLOBAL UPDATE */
      const globalT = gameState.globalTeams.find(gt => gt.name === t.name);
      if (globalT) {
        globalT.score += pointsCombined;
      }

    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();
    io.emit("revealTotal", data);
  });


  /* -----------------------------
  STRIKES
  ------------------------------*/

  socket.on("addStrike", (data) => {
    // Handle both {team: 'A'} and simple 'A' formats
    const team = (data && data.team) ? data.team : data;
    const teamKey = team === "A" ? "teamA" : "teamB";

    if (gameState[teamKey]) {
      gameState[teamKey].strikes = Math.min(3, (gameState[teamKey].strikes || 0) + 1);
      io.emit("stateUpdate", getSafeState());
      saveSessionState();

      io.emit("strikeUpdate", {
        teamA: gameState.teamA.strikes,
        teamB: gameState.teamB.strikes
      });
      io.emit("playBuzzer");
    }
  });

  socket.on("resetStrikes", () => {
    gameState.teamA.strikes = 0;
    gameState.teamB.strikes = 0;
    io.emit("stateUpdate", getSafeState());
    saveSessionState();
    io.emit("strikeUpdate", { teamA: 0, teamB: 0 });
  });

  socket.on("setActivePlayer", (data) => {
    gameState.activePlayer = (data && data.player) ? data.player : data;
    io.emit("stateUpdate", getSafeState());
    saveSessionState();
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
    saveSessionState();
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
    saveSessionState();
  });

  socket.on("markCross", () => {
    const maxAnswers = gameState.currentQuestion?.answers?.length || 8;
    if (gameState.revealedAnswers.length >= maxAnswers) return;

    const wrongAnswer = { answer: "❌", weight: 0 };
    gameState.revealedAnswers.push(wrongAnswer);
    io.emit("stateUpdate", getSafeState());
    saveSessionState();

    io.emit("answerRevealed", {
      answer: wrongAnswer,
      team: gameState.activePlayer?.[0] || "A",
      playerIndex: 0
    });
  });

  socket.on("nextQuestion", () => {
    if (gameState.currentQuestionIndex < gameState.allQuestions.length - 1) {
      gameState.currentQuestionIndex++;
      gameState.currentQuestion = gameState.allQuestions[gameState.currentQuestionIndex];
      gameState.revealedAnswers = [];
      gameState.activePlayer = "none";
      io.emit("stateUpdate", getSafeState());
      saveSessionState();
    }
  });

  socket.on("previousQuestion", () => {
    if (gameState.currentQuestionIndex > 0) {
      gameState.currentQuestionIndex--;
      gameState.currentQuestion = gameState.allQuestions[gameState.currentQuestionIndex];
      gameState.revealedAnswers = [];
      gameState.activePlayer = "none";
      io.emit("stateUpdate", getSafeState());
      saveSessionState();
    }
  });

  socket.on("revealAnswer", (data) => {
    // Handle both index-based and object-based reveals
    if (data && data.index !== undefined) {
      if (!gameState.revealedAnswers.includes(data.index)) {
        gameState.revealedAnswers.push(data.index);
        io.emit("stateUpdate", getSafeState());
        saveSessionState();
      }
      return;
    }

    const answer = data.answer;
    if (!answer || !answer.answer) return;
    if (gameState.revealedAnswers.some(a => a.answer === answer.answer)) return;

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
      const globalT = gameState.globalTeams.find(t => t.name === gameState[teamKey].name);
      if (globalT) {
        globalT.score += answer.weight;
        syncTeamToSupabase(globalT);
      }
    }

    io.emit("stateUpdate", getSafeState());
    saveSessionState();
    io.emit("answerRevealed", data);
  });

  socket.on("hideAnswer", (data) => {
    if (data && data.index !== undefined) {
      gameState.revealedAnswers = gameState.revealedAnswers.filter(idx => idx !== data.index);
      io.emit("stateUpdate", getSafeState());
      saveSessionState();
    }
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
    saveSessionState();
  });


  socket.on("hideThankYou", () => {

    gameState.showThankYou = false;

    io.emit("showThankYouScreen", false);
    saveSessionState();
  });


  /* -----------------------------
  LEADERBOARD
  ------------------------------*/

  socket.on("toggleLeaderboard", (data) => {
    io.emit("leaderboardToggle", {
      show: data.show,
      teams: gameState.globalTeams || []
    });
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Game Show Server is LIVE!`);
  console.log(`🔗 Local view: http://localhost:${PORT}`);
  console.log(`🌐 Production: listening on 0.0.0.0:${PORT}`);

  if (!isSupabaseConfigured) {
    console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.warn("🚨 ATTENTION: SUPABASE NOT CONFIGURED!");
    console.warn("Game will run, but NO DATA will be saved.");
    console.warn("Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Railway Variables.");
    console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }
});