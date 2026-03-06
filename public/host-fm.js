const socket = io();

/* ================= SUPABASE STATUS ================= */
socket.on("supabaseStatus", (status) => {
    const statusEl = document.getElementById("supabaseStatus");
    if (!statusEl) return;

    const dot = statusEl.querySelector(".status-dot");
    const text = statusEl.querySelector(".status-text");

    if (status.connected) {
        statusEl.classList.add("connected");
        statusEl.classList.remove("error");
        text.textContent = "Supabase Connected";
    } else {
        statusEl.classList.remove("connected");
        statusEl.classList.add("error");
        text.textContent = status.configured ? "Supabase Error" : "Supabase Not Configured";
    }
});

let fmQuestions = [];
let currentQuestionIndex = -1;
let currentQuestion = null;
let revealedAnswers = [];
let currentActivePlayer = 'none';


/* =====================================================
CUSTOM JSON UPLOAD
===================================================== */

let pendingFmQuestions = null;

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            let tempQuestions = [];

            if (data?.sets?.length) {
                tempQuestions = data.sets.flatMap(set => set.questions || []);
            }
            else if (data?.questions) {
                tempQuestions = data.questions;
            }
            else if (Array.isArray(data)) {
                tempQuestions = data;
            }

            if (!tempQuestions.length) {
                alert('No valid questions found in the uploaded JSON file.');
                return;
            }

            pendingFmQuestions = tempQuestions;

            const statusEl = document.getElementById("fmUploadStatus");
            if (statusEl) {
                statusEl.textContent = "File Ready";
                statusEl.style.color = "#ffd700";
                statusEl.style.display = "inline";
            }

        } catch (error) {
            console.error("Error parsing JSON:", error);
            alert("Error parsing JSON file.");
        }
    };
    reader.readAsText(file);
}

// Add event listener for the Load JSON button
document.addEventListener("DOMContentLoaded", () => {
    const loadBtn = document.getElementById("fmLoadJsonBtn");
    if (loadBtn) {
        loadBtn.addEventListener("click", () => {
            if (!pendingFmQuestions) {
                alert("Please select a JSON file first.");
                return;
            }

            fmQuestions = pendingFmQuestions;
            currentQuestionIndex = -1;
            currentQuestion = null;
            revealedAnswers = [];

            populateQuestionSelector();

            const statusEl = document.getElementById("fmUploadStatus");
            if (statusEl) {
                statusEl.textContent = "JSON Loaded!";
                statusEl.style.color = "#00ff88";
                statusEl.style.display = "inline";
                setTimeout(() => {
                    statusEl.style.display = "none";
                }, 3000);
            }

            pendingFmQuestions = null;
        });
    }
});


/* =====================================================
LOAD QUESTIONS
===================================================== */

fetch(`/questions/fm_questions.json?v=${Date.now()}`)
    .then(r => r.json())
    .then(data => {

        if (Array.isArray(data?.sets)) {
            fmQuestions = data.sets.flatMap(set => set.questions || []);
        }
        else if (Array.isArray(data?.games)) {
            fmQuestions = data.games.flatMap(game => game.questions || []);
        }
        else if (Array.isArray(data?.questions)) {
            fmQuestions = data.questions;
        }
        else if (Array.isArray(data)) {
            fmQuestions = data;
        }
        else {
            console.error('Unknown question format:', data);
            fmQuestions = [];
        }

        populateQuestionSelector();

    })
    .catch(err => console.error('Error loading FM questions:', err));


/* =====================================================
QUESTION SELECTOR
===================================================== */

function populateQuestionSelector() {

    const selector = document.getElementById('questionSelector');
    if (!selector) return;

    selector.innerHTML = '<option value="">Select a question...</option>';

    fmQuestions.forEach((q, idx) => {

        const option = document.createElement('option');

        option.value = idx;
        option.textContent = `Q${q.question_number ?? idx + 1}: ${q.question}`;

        selector.appendChild(option);

    });

}


function selectQuestion() {

    const selector = document.getElementById('questionSelector');
    if (!selector) return;

    const idx = parseInt(selector.value);

    if (isNaN(idx) || !fmQuestions[idx]) return;

    currentQuestionIndex = idx;
    currentQuestion = fmQuestions[idx];
    revealedAnswers = [];

    // Trigger display visibility
    socket.emit("roundChanged", { round: "Fast Money" });

    displayQuestion();

}


/* =====================================================
DISPLAY QUESTION
===================================================== */

function displayQuestion(shouldBroadcast = true) {

    if (!currentQuestion) return;

    const qText = document.getElementById('questionText');
    const answersList = document.getElementById('answersList');
    const selector = document.getElementById('questionSelector');

    if (qText) qText.textContent = currentQuestion.question;

    if (selector) selector.value = currentQuestionIndex;

    if (shouldBroadcast) {
        socket.emit("broadcastCurrentQuestion", currentQuestion);
    }

    if (!answersList) return;

    answersList.innerHTML = '';

    const answers = currentQuestion.answers || [];

    answers.forEach(answer => {

        const revealedData = revealedAnswers.find(r => r.answer === answer.answer);
        const isRevealed = !!revealedData;

        const safeAnswer = String(answer.answer)
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"');

        const row = document.createElement('div');
        row.className = `answer-row ${isRevealed ? 'revealed' : ''}`;

        let buttonsHTML = '';

        if (isRevealed) {

            buttonsHTML = `
            <div class="answer-selected">
            Already selected by Player ${revealedData.playerIndex + 1}
            </div>`;

        } else {

            buttonsHTML = `
            <button class="btn btn-small btn-team-a"
            onclick="revealAnswer('A',0,'${safeAnswer}',${answer.weight})">P1</button>

            <button class="btn btn-small btn-team-a"
            onclick="revealAnswer('A',1,'${safeAnswer}',${answer.weight})">P2</button>
            `;

        }

        row.innerHTML = `
        <div class="answer-text">
        ${answer.answer}
        <span class="answer-weight">(${answer.weight ?? ''})</span>
        </div>

        <div class="answer-buttons">
        ${buttonsHTML}
        </div>
        `;

        answersList.appendChild(row);

    });

}


/* =====================================================
REVEAL ANSWER
===================================================== */

function revealAnswer(team, playerIndex, answerText, weight) {

    if (currentActivePlayer === 'none') {
        alert('⚠️ Please select an Active Player first');
        return;
    }

    if (!currentQuestion) return;

    const exists = revealedAnswers.find(a => a.answer === answerText);
    if (exists) return;

    revealedAnswers.push({
        answer: answerText,
        team,
        playerIndex
    });

    socket.emit('revealAnswer', {
        team,
        playerIndex,
        answer: {
            answer: answerText,
            weight: weight
        }
    });

    displayQuestion(false);

    setTimeout(() => {
        nextQuestion();
    }, 600);

}


/* =====================================================
QUESTION NAVIGATION
===================================================== */

function nextQuestion() {

    if (currentQuestionIndex < fmQuestions.length - 1) {

        currentQuestionIndex++;

        const selector = document.getElementById('questionSelector');
        if (selector) selector.value = currentQuestionIndex;

        currentQuestion = fmQuestions[currentQuestionIndex];

        displayQuestion();
    }

}

function prevQuestion() {

    if (currentQuestionIndex > 0) {

        currentQuestionIndex--;

        const selector = document.getElementById('questionSelector');
        if (selector) selector.value = currentQuestionIndex;

        currentQuestion = fmQuestions[currentQuestionIndex];

        displayQuestion();

    }

}


/* =====================================================
BOARD CONTROL
===================================================== */

function clearBoard() {

    revealedAnswers = [];
    socket.emit('clearBoard');

}

function markCross() {

    if (currentActivePlayer === 'none') {
        alert('⚠️ Select Active Player first');
        return;
    }

    socket.emit('markCross');

    setTimeout(() => {
        nextQuestion();
    }, 600);

}


/* =====================================================
TEAM REGISTRATION & MATCHUPS
===================================================== */

function registerTeam() {

    const name = document.getElementById('regTeamName')?.value.trim();
    const p1 = document.getElementById('regPlayer1')?.value.trim();
    const p2 = document.getElementById('regPlayer2')?.value.trim();

    if (!name) {
        alert("Please enter a Team Name.");
        return;
    }

    const players = [];
    if (p1) players.push(p1);
    if (p2) players.push(p2);

    if (players.length === 0) {
        players.push("Player 1", "Player 2");
    }

    socket.emit('registerTeam', { name, players });

    /* Clear inputs after registering */
    const nameEl = document.getElementById('regTeamName');
    const p1El = document.getElementById('regPlayer1');
    const p2El = document.getElementById('regPlayer2');

    if (nameEl) nameEl.value = "";
    if (p1El) p1El.value = "";
    if (p2El) p2El.value = "";

    alert(`Registered ${name} with players: ${players.join(", ")}`);

}

function removeTeam(teamName) {
    if (confirm(`Remove ${teamName} from Tournament?`)) {
        socket.emit('removeTeam', { name: teamName });
    }
}

function setMatchupFromSelect() {

    const teamA = document.getElementById('teamSelectA')?.value;

    if (!teamA) {
        alert("Please select a team from the dropdown.");
        return;
    }

    console.log("Setting Fast Money Matchup:", teamA);
    socket.emit('setMatchup', { teamA, teamB: 'Team B' });

    // Provide visual feedback on the button
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = "Matchup Set!";
    btn.classList.replace('btn-primary', 'btn-success');

    setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.replace('btn-success', 'btn-primary');
    }, 2000);
}


/* =====================================================
ACTIVE PLAYER MANAGEMENT
===================================================== */

function setActivePlayer() {

    const selector = document.getElementById('activePlayerSelector');
    if (!selector) return;

    const player = selector.value;

    socket.emit('setActivePlayer', { player });

    currentActivePlayer = player;

    if (player !== 'none') {
        revealedAnswers = [];
        socket.emit('clearBoard');
    }

}


/* =====================================================
SCORE MANAGEMENT
===================================================== */

function addScore(team, playerIndex) {

    const points = parseInt(document.getElementById('pointsInput')?.value) || 0;

    if (points > 0) {
        socket.emit('addScore', { team, playerIndex, points });
    }

}

function deductScore(playerIndex) {

    const points = parseInt(document.getElementById('pointsInput')?.value) || 0;

    if (points > 0) {
        socket.emit('addScore', { team: 'A', playerIndex, points: -points });
    }

}


/* =====================================================
TIMER MANAGEMENT
===================================================== */

function startTimer() {

    const duration = parseInt(document.getElementById('timerInput')?.value) || 60;

    socket.emit('startTimer', { duration });

}

function stopTimer() {
    socket.emit('stopTimer');
}

function resetTimer() {

    socket.emit('resetTimer');

    const timer = document.getElementById('timerDisplay');
    if (timer) timer.textContent = '00:00';

}


/* =====================================================
END GAME & RESET
===================================================== */

function showTeamScore(team) {
    socket.emit('showTeamScore', { team });
}

function checkWin() {
    socket.emit('checkFmWin');
}

function hideRevealScreen() {
    socket.emit('hideRevealScreen');
}

function showThankYou() {

    if (confirm('End the game and show Thank You screen?')) {
        socket.emit('showThankYou');
    }

}

function resetGame() {

    if (confirm("Reset entire game?")) {

        /* FIX #1: Emit reset to server first */
        socket.emit("resetGame");

        /* FIX #2: Clear local state */
        revealedAnswers = [];

        /* FIX #2: CRITICAL - Reset active player selector dropdown */
        const selector = document.getElementById('activePlayerSelector');
        if (selector) selector.value = 'none';

        /* FIX #3: Reset currentActivePlayer state variable */
        currentActivePlayer = 'none';

        /* FIX #4: Reset points input */
        const points = document.getElementById("pointsInput");
        if (points) points.value = "0";

        /* FIX #5: Reset timer display */
        const timer = document.getElementById('timerDisplay');
        if (timer) timer.textContent = '00:00';

        /* FIX #6: Reset question selector */
        const questionSelector = document.getElementById('questionSelector');
        if (questionSelector) questionSelector.value = '';

        /* FIX #7: Clear current question */
        currentQuestion = null;
        currentQuestionIndex = -1;

    }

}


/* =====================================================
SOCKET EVENT HANDLERS
===================================================== */

socket.on('timerUpdate', (seconds) => {

    const safeSeconds = Number(seconds) || 0;

    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;

    const timer = document.getElementById('timerDisplay');

    if (timer) {
        timer.textContent =
            `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

});

function toggleQuestionVisibility(show) {
    socket.emit("toggleQuestionVisibility", { show });
}

/* STATE UPDATE */

socket.on("stateUpdate", (state) => {

    if (state.showQuestion !== undefined) {
        const toggle = document.getElementById("fmToggleQuestionVisibility");
        if (toggle) toggle.checked = state.showQuestion;
    }

    if (!state?.teamA) return;

    /* Update scores */
    const p1 = state.teamA.playerScores?.[0] || 0;
    const p2 = state.teamA.playerScores?.[1] || 0;
    const combined = p1 + p2;

    const scoreP1 = document.getElementById('scoreP1');
    const scoreP2 = document.getElementById('scoreP2');
    const scoreCombined = document.getElementById('scoreCombined');

    if (scoreP1) scoreP1.textContent = p1;
    if (scoreP2) scoreP2.textContent = p2;
    if (scoreCombined) scoreCombined.textContent = combined;

    /* Update active player */
    currentActivePlayer = state.activePlayer || 'none';

    const selector = document.getElementById('activePlayerSelector');
    if (selector && selector.value !== state.activePlayer) {
        selector.value = state.activePlayer || 'none';
    }

    /* Update global teams dropdowns */
    if (state.globalTeams) {
        const selectA = document.getElementById('teamSelectA');

        if (selectA) {
            const currentA = selectA.value;
            selectA.innerHTML = '<option value="">-- Select Team --</option>';
            state.globalTeams.forEach(t => {
                const optA = document.createElement('option');
                optA.value = t.name;
                optA.textContent = t.name;
                selectA.appendChild(optA);
            });
            /* Restore selection if it still exists */
            if (state.globalTeams.some(t => t.name === currentA)) {
                selectA.value = currentA;
            }
        }

        /* Update Global Roster List */
        const rosterList = document.getElementById('rosterList');
        if (rosterList) {
            globalTeamsData = state.globalTeams || [];
            renderRosterList(globalTeamsData);
        }
    }

});

let globalTeamsData = [];
let teamSearchQuery = "";

function handleTeamSearch(query) {
    teamSearchQuery = query.toLowerCase().trim();
    renderRosterList(globalTeamsData);
}

function renderRosterList(teams) {
    const rosterList = document.getElementById('rosterList');
    if (!rosterList) return;

    rosterList.innerHTML = '';

    const filteredTeams = teams.filter(t => {
        if (!teamSearchQuery) return true;
        return t.name.toLowerCase().includes(teamSearchQuery) ||
            t.players.some(p => p.toLowerCase().includes(teamSearchQuery));
    });

    if (filteredTeams.length === 0) {
        rosterList.innerHTML = `<div style="color:#a8b2d1; font-size:12px; font-style:italic;">
            ${teamSearchQuery ? 'No teams matching your search.' : 'No teams registered.'}
        </div>`;
    } else {
        filteredTeams.forEach(t => {
            const tCard = document.createElement('div');
            tCard.className = 'roster-item';

            const tInfo = document.createElement('div');
            tInfo.className = 'roster-info';
            tInfo.innerHTML = `
                <span class="roster-team-name">${t.name}</span>
                <span class="roster-players">Players: ${t.players.join(', ')}</span>
                <span class="roster-score">Points: ${t.score}</span>
            `;

            const tDeleteBtn = document.createElement('button');
            tDeleteBtn.className = "btn btn-small btn-danger";
            tDeleteBtn.textContent = "X";
            tDeleteBtn.title = "Delete Team";
            tDeleteBtn.onclick = () => removeTeam(t.name);

            tCard.appendChild(tInfo);
            tCard.appendChild(tDeleteBtn);
            rosterList.appendChild(tCard);
        });
    }
}


/* =====================================================
SOCKET CONNECTION
===================================================== */

socket.on('connect', () => {
    console.log('Connected to FM Host server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from FM Host server');
});

socket.on('reconnect', () => {
    console.log('Reconnected to FM Host server');
});

/* =====================================================
LEADERBOARD TOGGLE
===================================================== */

function toggleLeaderboard(show) {
    socket.emit("toggleLeaderboard", { show: show });
}