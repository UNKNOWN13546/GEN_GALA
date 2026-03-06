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

let currentQuestion = null;
let currentRound = null;
let allQuestions = [];
let currentIndex = 0;
let revealedAnswers = new Set();

const QUALIFY_SCORE_R1R2 = 150;


/* =====================================================
CUSTOM JSON UPLOAD
===================================================== */

let pendingQuestions = null;
let pendingFileName = "";

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            let tempQuestions = [];

            /* SUPPORT MULTIPLE JSON FORMATS */
            if (Array.isArray(data?.sets)) {
                data.sets.forEach(set => {
                    if (Array.isArray(set.questions)) {
                        tempQuestions = tempQuestions.concat(set.questions);
                    }
                });
            }
            if (Array.isArray(data?.matches)) {
                data.matches.forEach(match => {
                    if (Array.isArray(match.questions)) {
                        tempQuestions = tempQuestions.concat(match.questions);
                    }
                });
            }
            if (Array.isArray(data?.questions)) {
                tempQuestions = tempQuestions.concat(data.questions);
            }

            if (!tempQuestions.length) {
                alert("No valid questions found in the uploaded JSON file.");
                return;
            }

            pendingQuestions = tempQuestions;
            pendingFileName = file.name;

            const statusEl = document.getElementById("foffUploadStatus");
            if (statusEl) {
                statusEl.textContent = "Ready to Load";
                statusEl.style.color = "#ffd700";
                statusEl.style.display = "inline";
            }

        } catch (error) {
            console.error("Error parsing uploaded JSON:", error);
            alert("Error parsing JSON file. Please ensure it is correctly formatted.");
        }
    };
    reader.readAsText(file);
}

// Add event listener for the Load JSON button
document.addEventListener("DOMContentLoaded", () => {
    populateQuestionSelector();
    const loadBtn = document.getElementById("foffLoadJsonBtn");
    if (loadBtn) {
        loadBtn.addEventListener("click", () => {
            if (!pendingQuestions) {
                alert("Please select a JSON file first.");
                return;
            }

            allQuestions = pendingQuestions;

            /* RESET ROUND STATE */
            currentRound = currentRound || "custom";
            currentIndex = 0;
            currentQuestion = null;
            revealedAnswers.clear();

            socket.emit("loadQuestions", { questions: allQuestions });
            socket.emit("roundChanged", { round: currentRound === "custom" ? "Custom Upload" : currentRound });

            populateQuestionSelector();
            displayQuestion(0);

            const statusEl = document.getElementById("foffUploadStatus");
            if (statusEl) {
                statusEl.textContent = "JSON Loaded!";
                statusEl.style.color = "#00ff88";
                statusEl.style.display = "inline";
                setTimeout(() => {
                    statusEl.style.display = "none";
                }, 3000);
            }

            pendingQuestions = null;
            pendingFileName = "";
        });
    }
});


/* =====================================================
ROUND SELECTOR & QUESTION LOADING
===================================================== */

const roundSelector = document.getElementById("roundSelector");

if (roundSelector) {

    roundSelector.addEventListener("change", async (e) => {

        const round = e.target.value;
        if (!round) return;

        try {

            let url = "";

            if (round === "round0") {
                url = "/questions/foff_round0.json";
            }
            else if (round === "round1") {
                url = "/questions/foff_round1.json";
            }
            else if (round === "round2") {
                url = "/questions/foff_round2.json";
            }
            else {
                console.error("Unknown round:", round);
                return;
            }

            const response = await fetch(`${url}?v=${Date.now()}`);

            if (!response.ok) {
                throw new Error(`Failed to load question file: ${response.statusText}`);
            }

            const data = await response.json();

            allQuestions = [];

            /* SUPPORT MULTIPLE JSON FORMATS */
            if (Array.isArray(data?.sets)) {
                allQuestions = data.sets.flatMap(set => set.questions || []);
            }
            else if (Array.isArray(data?.matches)) {
                allQuestions = data.matches.flatMap(match => match.questions || []);
            }
            else if (Array.isArray(data?.questions)) {
                allQuestions = data.questions;
            }
            else if (Array.isArray(data)) {
                allQuestions = data;
            }

            /* RESET ROUND STATE */

            currentRound = round;
            currentIndex = 0;
            currentQuestion = null;
            revealedAnswers.clear();

            socket.emit("loadQuestions", { questions: allQuestions });
            socket.emit("roundChanged", { round: currentRound });

            if (allQuestions.length) {
                populateQuestionSelector();
                displayQuestion(0);
            } else {
                console.warn("No questions loaded for round:", round);
            }

        }
        catch (error) {

            console.error("Error loading round:", error);
            alert(`Error loading round: ${error.message}`);

        }

    });

}


/* =====================================================
QUESTION SELECTOR
===================================================== */

function populateQuestionSelector() {
    console.log("Populating selector, questions count:", allQuestions.length);
    const selector = document.getElementById('questionSelector');
    if (!selector) {
        console.error("RED ALERT: #questionSelector element NOT found in DOM!");
        return;
    }

    selector.innerHTML = '<option value="">Select a question...</option>';

    allQuestions.forEach((q, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        const qText = q.question || "No Text";
        option.textContent = `Q${idx + 1}: ${qText.substring(0, 50)}${qText.length > 50 ? '...' : ''}`;
        selector.appendChild(option);
    });

    selector.value = currentIndex;
    console.log("Selector populated and set to index:", currentIndex);
}

function selectQuestion() {
    const selector = document.getElementById('questionSelector');
    if (!selector) return;

    const idx = parseInt(selector.value);
    if (isNaN(idx) || !allQuestions[idx]) return;

    revealedAnswers.clear();
    socket.emit("resetStrikes");
    socket.emit("clearBoard");

    displayQuestion(idx);
}


/* =====================================================
DISPLAY QUESTION
===================================================== */

function displayQuestion(index, broadcast = true) {

    if (!allQuestions.length) {
        console.warn("No questions available");
        return;
    }

    if (index < 0 || index >= allQuestions.length) {
        console.warn("Invalid question index:", index);
        return;
    }

    currentIndex = index;
    currentQuestion = allQuestions[index];

    // Sync selector
    const selector = document.getElementById('questionSelector');
    if (selector) selector.value = index;

    const questionText = document.getElementById("questionText");

    if (questionText && currentQuestion?.question) {

        questionText.textContent = currentQuestion.question;

        if (broadcast) {
            socket.emit("broadcastCurrentQuestion", currentQuestion);
        }

    }

    const answersList = document.getElementById("answersList");
    if (!answersList) return;

    answersList.innerHTML = "";

    const answers = currentQuestion.answers || [];

    answers.forEach(answer => {

        if (!answer?.answer) return;

        const isRevealed = revealedAnswers.has(answer.answer);

        const safeAnswer = String(answer.answer)
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"');

        const row = document.createElement("div");
        row.className = `answer-row ${isRevealed ? 'revealed' : ''}`;

        row.innerHTML = `

<div class="answer-text">
${answer.answer}
<span class="answer-weight">(${answer.weight ?? 0})</span>
</div>

<div class="answer-buttons">

<button class="btn btn-small btn-team-a"
onclick="revealAnswer('A','${safeAnswer}',${answer.weight ?? 0})"
${isRevealed ? "disabled" : ""}>
A
</button>

<button class="btn btn-small btn-team-b"
onclick="revealAnswer('B','${safeAnswer}',${answer.weight ?? 0})"
${isRevealed ? "disabled" : ""}>
B
</button>

</div>
`;

        answersList.appendChild(row);

    });

}


/* =====================================================
REVEAL ANSWER
===================================================== */

function revealAnswer(team, answerText, weight) {

    if (!currentQuestion) {
        console.warn("No current question");
        return;
    }

    if (revealedAnswers.has(answerText)) {
        console.log("Answer already revealed:", answerText);
        return;
    }

    revealedAnswers.add(answerText);

    socket.emit("revealAnswer", {

        team: team,

        answer: {
            answer: answerText,
            weight: weight
        }

    });

    displayQuestion(currentIndex, false);

}


/* =====================================================
TEAM REGISTRATION & MATCHUP
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
    const teamB = document.getElementById('teamSelectB')?.value;

    if (!teamA || !teamB) {
        alert("Please select both Team A and Team B from the dropdowns.");
        return;
    }

    if (teamA === teamB) {
        alert("Team A and Team B cannot be the same team.");
        return;
    }

    /* Set them as the active playing teams */
    socket.emit("setMatchup", { teamA, teamB });

}


/* =====================================================
GAME RESET
===================================================== */

function resetGame() {

    if (!confirm("Reset all scores and strikes?")) return;

    /* Clear local state */
    revealedAnswers.clear();
    currentIndex = 0;
    currentQuestion = null;
    allQuestions = [];

    /* Emit reset to server */
    socket.emit("resetGame");

    /* Reset round selector */
    if (roundSelector) {
        roundSelector.value = '';
    }

    /* Reset display */
    const questionText = document.getElementById("questionText");
    if (questionText) {
        questionText.textContent = "Load a round to start...";
    }

    const answersList = document.getElementById("answersList");
    if (answersList) {
        answersList.innerHTML = "<p>Select a round to display answers</p>";
    }

    const qualifyMessage = document.getElementById("qualifyMessage");
    if (qualifyMessage) {
        qualifyMessage.textContent = "";
    }

    socket.emit("broadcastCurrentQuestion", { question: "Load a question to start...", answers: [] });

}


/* =====================================================
SCORE CONTROL
===================================================== */

function addScore(team) {

    const points = parseInt(document.getElementById("pointsInput")?.value) || 0;

    if (points <= 0) {
        alert("Please enter a valid point value");
        return;
    }

    socket.emit("addScore", { team, points });

}

function deductScore(team) {

    const points = parseInt(document.getElementById("pointsInput")?.value) || 0;

    if (points <= 0) {
        alert("Please enter a valid point value");
        return;
    }

    socket.emit("deductScore", { team, points });

}


/* =====================================================
STRIKE MANAGEMENT
===================================================== */

function addStrike(team) {

    socket.emit("addStrike", { team });

}

function resetStrikes() {

    socket.emit("resetStrikes");

}


/* =====================================================
LEADERBOARD TOGGLE
===================================================== */

function toggleLeaderboard(show) {
    socket.emit("toggleLeaderboard", { show: show });
}


/* =====================================================
QUESTION NAVIGATION
===================================================== */

function nextQuestion() {

    if (!allQuestions.length) {
        console.warn("No questions loaded");
        return;
    }

    if (currentIndex < allQuestions.length - 1) {

        currentIndex++;

        revealedAnswers.clear();

        socket.emit("resetStrikes");
        socket.emit("clearBoard");

        displayQuestion(currentIndex);

    } else {

        console.log("Already at last question");

    }

}

function previousQuestion() {

    if (!allQuestions.length) {
        console.warn("No questions loaded");
        return;
    }

    if (currentIndex > 0) {

        currentIndex--;

        revealedAnswers.clear();

        socket.emit("resetStrikes");
        socket.emit("clearBoard");

        displayQuestion(currentIndex);

    } else {

        console.log("Already at first question");

    }

}


/* =====================================================
SERVER STATE UPDATE
===================================================== */

function toggleQuestionVisibility(show) {
    socket.emit("toggleQuestionVisibility", { show });
}

socket.on("stateUpdate", (state) => {
    if (state.showQuestion !== undefined) {
        const toggle = document.getElementById("toggleQuestionVisibility");
        if (toggle) toggle.checked = state.showQuestion;
    }
    /* Rest of stateUpdate... */

    if (!state?.teamA || !state?.teamB) return;

    const scoreA = state.teamA.score ?? 0;
    const scoreB = state.teamB.score ?? 0;

    const qualifyMessage = document.getElementById("qualifyMessage");
    if (!qualifyMessage) return;

    /* ELIMINATION ROUND HAS NO QUALIFY MESSAGE */

    if (currentRound === "round0") {
        qualifyMessage.textContent = "";
        return;
    }

    /* Check qualification status */

    if (scoreA >= QUALIFY_SCORE_R1R2 && scoreB >= QUALIFY_SCORE_R1R2) {

        qualifyMessage.textContent =
            `${state.teamA.name} and ${state.teamB.name} both qualify!`;

    }
    else if (scoreA >= QUALIFY_SCORE_R1R2) {

        qualifyMessage.textContent =
            `${state.teamA.name} qualifies for the next round!`;

    }
    else if (scoreB >= QUALIFY_SCORE_R1R2) {

        qualifyMessage.textContent =
            `${state.teamB.name} qualifies for the next round!`;

    }
    else {

        qualifyMessage.textContent = "";

    }

    /* Update global teams dropdowns */
    if (state.globalTeams) {
        const selectA = document.getElementById('teamSelectA');
        const selectB = document.getElementById('teamSelectB');

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

        if (selectB) {
            const currentB = selectB.value;
            selectB.innerHTML = '<option value="">-- Select Team --</option>';
            state.globalTeams.forEach(t => {
                const optB = document.createElement('option');
                optB.value = t.name;
                optB.textContent = t.name;
                selectB.appendChild(optB);
            });
            /* Restore selection if it still exists */
            if (state.globalTeams.some(t => t.name === currentB)) {
                selectB.value = currentB;
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

function adjustScore(teamName, amount) {
    if (!amount) {
        const input = document.getElementById(`scoreAdjustInput_${teamName}`);
        amount = parseInt(input?.value) || 0;
    }
    if (amount === 0) return;
    socket.emit("adjustTeamScore", { name: teamName, amount: amount });
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
            tCard.style.flexDirection = 'column';
            tCard.style.alignItems = 'flex-start';
            tCard.style.gap = '15px';

            const tInfo = document.createElement('div');
            tInfo.className = 'roster-info';
            tInfo.style.width = '100%';
            tInfo.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="roster-team-name" style="font-size:1.3rem;">${t.name}</span>
                    <span class="roster-score" style="font-size:1.1rem;">Points: ${t.score}</span>
                </div>
                <span class="roster-players">Players: ${t.players.join(', ')}</span>
            `;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'roster-actions';
            actionsDiv.style.display = 'flex';
            actionsDiv.style.alignItems = 'center';
            actionsDiv.style.gap = '12px';
            actionsDiv.style.width = '100%';
            actionsDiv.style.paddingTop = '10px';
            actionsDiv.style.borderTop = '1px solid rgba(255,255,255,0.05)';

            const scoreInput = document.createElement('input');
            scoreInput.type = 'number';
            scoreInput.id = `scoreAdjustInput_${t.name}`;
            scoreInput.className = 'input-field';
            scoreInput.style.width = '100px';
            scoreInput.style.padding = '8px 12px';
            scoreInput.placeholder = '0';
            scoreInput.value = '';

            const addBtn = document.createElement('button');
            addBtn.className = 'btn btn-small btn-success';
            addBtn.textContent = '+ ADD';
            addBtn.style.padding = '8px 15px';
            addBtn.onclick = () => adjustScore(t.name);

            const subBtn = document.createElement('button');
            subBtn.className = 'btn btn-small btn-danger';
            subBtn.textContent = '- SUB';
            subBtn.style.padding = '8px 15px';
            subBtn.onclick = () => {
                const val = parseInt(scoreInput.value) || 0;
                adjustScore(t.name, -val);
            };

            const tDeleteBtn = document.createElement('button');
            tDeleteBtn.className = "btn btn-small btn-secondary";
            tDeleteBtn.textContent = "DELETE";
            tDeleteBtn.title = "Delete Team";
            tDeleteBtn.style.marginLeft = 'auto';
            tDeleteBtn.style.padding = '8px 12px';
            tDeleteBtn.style.fontSize = '0.7rem';
            tDeleteBtn.onclick = () => removeTeam(t.name);

            actionsDiv.appendChild(scoreInput);
            actionsDiv.appendChild(addBtn);
            actionsDiv.appendChild(subBtn);
            actionsDiv.appendChild(tDeleteBtn);

            tCard.appendChild(tInfo);
            tCard.appendChild(actionsDiv);
            rosterList.appendChild(tCard);
        });
    }
}


/* =====================================================
SOCKET CONNECTION
===================================================== */

socket.on("connect", () => {

    console.log("Host connected to server");

});

socket.on("disconnect", () => {

    console.log("Host disconnected from server");

});

socket.on("reconnect", () => {

    console.log("Host reconnected to server");

});