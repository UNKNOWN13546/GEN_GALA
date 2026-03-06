const socket = io();

let audioContext = null;
let currentQuestionData = null;
let currentRound = null;

/* FIX: Track previous state to prevent stale data */
let lastUpdateTime = 0;

/* -----------------------------
TEAM NAME UPDATE
------------------------------*/

/* Removed redundant teamUpdate */


/* -----------------------------
SCORE UPDATE
------------------------------*/

/* Removed redundant scoreUpdate */


/* -----------------------------
STRIKE UPDATE
------------------------------*/

let prevStrikesA = null;
let prevStrikesB = null;

function handleStrikesChanged(strikesA, strikesB) {

    if (prevStrikesA === null || prevStrikesB === null) {

        prevStrikesA = strikesA;
        prevStrikesB = strikesB;
        return;

    }

    if (strikesA === 3 && prevStrikesA < 3) {
        showChanceMessage("B");
    }

    if (strikesB === 3 && prevStrikesB < 3) {
        showChanceMessage("A");
    }

    prevStrikesA = strikesA;
    prevStrikesB = strikesB;

}


function showChanceMessage(chanceTeam) {

    const teamName =
        chanceTeam === "A"
            ? document.getElementById("teamAName")?.textContent || "TEAM A"
            : document.getElementById("teamBName")?.textContent || "TEAM B";

    const overlay = document.getElementById("chanceOverlay");
    const text = document.getElementById("chanceMessageText");
    const buzzer = document.getElementById("buzzerSound");

    if (!overlay || !text) return;

    text.textContent = `CHANCE TO ${teamName}!`;

    overlay.style.display = "flex";

    if (buzzer) {
        try {
            buzzer.currentTime = 0;
            buzzer.play().catch(() => { });
        } catch { }
    }

    setTimeout(() => {

        overlay.style.display = "none";

    }, 4000);

}


socket.on("strikeUpdate", (strikes) => {

    /* DOM updates are handled by stateUpdate, this only triggers the chance overlay */
    const strikesA = strikes?.teamA ?? 0;
    const strikesB = strikes?.teamB ?? 0;

    handleStrikesChanged(strikesA, strikesB);

});


function updateStrikesDisplay(team, count) {

    const element = document.getElementById(`strikes${team}`);
    if (!element) return;

    let html = "";

    for (let i = 0; i < 3; i++) {

        if (i < count) {
            html += '<span class="strike filled">✕</span>';
        } else {
            html += '<span class="strike empty">○</span>';
        }

    }

    element.innerHTML = html;

}


/* -----------------------------
ANSWER REVEAL
------------------------------*/

socket.on("answerRevealed", (data) => {

    const board = document.getElementById("answerBoard");
    if (!board) return;

    const boxes = board.querySelectorAll(".answer-box");
    if (!boxes.length) return;

    for (let box of boxes) {

        if (box.classList.contains("placeholder")) {

            box.classList.remove("placeholder");

            const answerText = data?.answer?.answer ?? "";
            const weight = data?.answer?.weight ?? "";

            box.innerHTML = `
                <div class="answer-text">${answerText}</div>
                <div class="answer-points">${weight}</div>
            `;

            box.style.animation = "slideIn 0.5s ease-out";

            break;

        }

    }

    playBuzzer();

});


/* -----------------------------
BUZZER SOUND
------------------------------*/

socket.on("playBuzzer", () => {

    playBuzzer();

});


function playBuzzer() {

    try {

        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = "sine";

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);

    } catch (error) {

        console.warn("Audio blocked by browser.");

    }

}


/* -----------------------------
TIMER UPDATE
------------------------------*/

socket.on("timerUpdate", (seconds) => {

    const timerDisplay = document.getElementById("timerDisplay");
    if (!timerDisplay) return;

    timerDisplay.style.display = "block";

    const safeSeconds = Number(seconds) || 0;

    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;

    timerDisplay.textContent =
        `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    timerDisplay.style.color =
        (safeSeconds <= 10 && safeSeconds > 0) ? "#ff1744" : "#ffd700";

});


socket.on("timerFinished", () => {

    const timerDisplay = document.getElementById("timerDisplay");
    if (!timerDisplay) return;

    timerDisplay.textContent = "00:00";
    timerDisplay.style.color = "#ff1744";

});


/* -----------------------------
THANK YOU SCREEN
------------------------------*/

socket.on("showThankYouScreen", (show) => {

    const gameScreen = document.getElementById("gameScreen");
    const thankYouScreen = document.getElementById("thankYouScreen");

    if (!gameScreen || !thankYouScreen) return;

    gameScreen.style.display = show ? "none" : "block";
    thankYouScreen.style.display = show ? "flex" : "none";

});


/* =====================================================
DISPLAY VISIBILITY HELPER
===================================================== */
function updateDisplayVisibility(round) {
    const gameScreen = document.getElementById("gameScreen");
    const boardGrid = document.getElementById("answerBoard");
    const titleContainer = document.querySelector(".gala-title-container");

    if (!gameScreen) return;

    if (!round || round === "" || round === "none") {
        gameScreen.style.visibility = "hidden";
        if (titleContainer) titleContainer.style.display = "block";
    } else {
        gameScreen.style.visibility = "visible";
        if (titleContainer) titleContainer.style.display = "none";
    }
}


/* =====================================================
STATE SYNC - COMPREHENSIVE (MAIN UPDATE)
===================================================== */

socket.on("stateUpdate", (state) => {

    if (!state) return;

    /* Update timestamp to detect stale updates */
    lastUpdateTime = Date.now();

    /* ===== ROUND & QUESTION INFO ===== */
    if (state.currentRound !== undefined) {
        currentRound = state.currentRound;
        updateRoundTitle(state.currentRound);
        updateDisplayVisibility(state.currentRound);
    }

    currentQuestionData = state.currentQuestion || null;

    const qBox = document.getElementById("audienceQuestionDisplay");

    if (qBox) {

        const qHeader = qBox.querySelector("h3");

        const shouldShow = state.showQuestion !== false;

        if (shouldShow && state.currentQuestion?.question &&
            state.currentQuestion.question !== "Load a question to start..." &&
            currentRound && currentRound !== "round0") {

            if (qHeader) qHeader.textContent = state.currentQuestion.question;
            qBox.style.display = "block";

        } else {

            qBox.style.display = "none";

        }

    }

    /* ===== TEAM NAMES & SCORES ===== */
    const teamA = document.getElementById("teamAName");
    const teamB = document.getElementById("teamBName");

    const scoreA = document.getElementById("teamAScore");
    const scoreB = document.getElementById("teamBScore");

    if (teamA && state.teamA) {
        teamA.textContent = state.teamA.name;
    }

    if (teamB && state.teamB) {
        teamB.textContent = state.teamB.name;
    }

    if (scoreA && state.teamA) {
        scoreA.textContent = state.teamA.score ?? 0;
    }

    if (scoreB && state.teamB) {
        scoreB.textContent = state.teamB.score ?? 0;
    }

    /* ===== STRIKES ===== */
    updateStrikesDisplay("A", state.teamA?.strikes ?? 0);
    updateStrikesDisplay("B", state.teamB?.strikes ?? 0);

    handleStrikesChanged(state.teamA?.strikes ?? 0, state.teamB?.strikes ?? 0);

    /* ===== ANSWER BOARD RESET ===== */
    if ((state.revealedAnswers ?? []).length === 0) {
        resetAnswerBoard();
    }

});


/* =====================================================
RESET ANSWER BOARD
===================================================== */

function resetAnswerBoard() {

    const board = document.getElementById("answerBoard");
    if (!board) return;

    board.innerHTML = "";

    const numBoxes = currentQuestionData?.answers?.length ?? 8;

    for (let i = 0; i < numBoxes; i++) {

        const box = document.createElement("div");

        box.className = "answer-box placeholder";
        box.textContent = "?";

        board.appendChild(box);

    }

}


/* =====================================================
QUESTION BROADCAST
===================================================== */

socket.on("broadcastCurrentQuestion", (questionData) => {

    currentQuestionData = questionData;

    const qBox = document.getElementById("audienceQuestionDisplay");
    if (!qBox) return;

    const qHeader = qBox.querySelector("h3");

    if (questionData?.question &&
        questionData.question !== "Load a question to start..." &&
        currentRound !== 'round0') {

        if (qHeader) qHeader.textContent = questionData.question;
        qBox.style.display = "block";

    } else {

        qBox.style.display = "none";

    }

    resetAnswerBoard();

});


/* =====================================================
ROUND TITLE UPDATE
===================================================== */

const ROUND_TITLES = {
    round0: "ROUND 0 — ELIMINATION",
    round1: "FACE OFF — ROUND 1",
    round2: "FACE OFF — ROUND 2"
};

function updateRoundTitle(round) {

    const titleEl = document.getElementById("roundTitle");
    if (!titleEl) return;

    titleEl.textContent = ROUND_TITLES[round] || "FACE OFF";

}


socket.on("roundChanged", (data) => {

    if (data?.round) {
        currentRound = data.round;
        updateRoundTitle(data.round);
    }

});


/* =====================================================
SOCKET CONNECTION MANAGEMENT
===================================================== */

socket.on("connect", () => {

    console.log("Display connected to server");

});

socket.on("disconnect", () => {

    console.log("Display disconnected from server");

});

socket.on("reconnect", () => {

    console.log("Display reconnected to server");

});


/* =====================================================
LEADERBOARD DISPLAY LOGIC
===================================================== */

socket.on("leaderboardToggle", (data) => {
    const overlayElement = document.getElementById("globalLeaderboardOverlay");
    if (!overlayElement) return;

    if (data.show) {
        const teams = data.teams || [];
        teams.sort((a, b) => b.score - a.score);

        let highestScore = teams.length > 0 ? teams[0].score : 0;

        let rowsHtml = teams.map((team, index) => {
            const isWinner = team.score === highestScore && highestScore > 0;
            const rank = index + 1;

            return `
                <tr class="${isWinner ? 'winner-row' : ''}">
                    <td>
                        ${isWinner ? '<span class="lb-table-crown">👑</span>' : ''}
                        <span class="rank-badge">${rank}</span>
                    </td>
                    <td>
                        <div class="lb-table-team-name">${team.name}</div>
                    </td>
                    <td>${team.score}</td>
                </tr>
            `;
        }).join('');

        const container = document.getElementById("leaderboardBody");
        if (container) {
            container.innerHTML = rowsHtml;
        }

        overlayElement.classList.add("show");
    } else {
        overlayElement.classList.remove("show");
    }
});