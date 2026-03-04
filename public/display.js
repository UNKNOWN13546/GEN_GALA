const socket = io();

let audioContext = null;

/* -----------------------------
   TEAM NAME UPDATE
------------------------------*/
socket.on("teamUpdate", (teams) => {
    const teamA = document.getElementById("teamAName");
    const teamB = document.getElementById("teamBName");

    if (teamA) teamA.textContent = teams.teamA.name;
    if (teamB) teamB.textContent = teams.teamB.name;
});

/* -----------------------------
   SCORE UPDATE
------------------------------*/
socket.on("scoreUpdate", (scores) => {
    const scoreA = document.getElementById("teamAScore");
    const scoreB = document.getElementById("teamBScore");

    if (scoreA) scoreA.textContent = scores.teamA;
    if (scoreB) scoreB.textContent = scores.teamB;
});

/* -----------------------------
   STRIKE UPDATE
------------------------------*/
let prevStrikesA = -1;
let prevStrikesB = -1;

function handleStrikesChanged(strikesA, strikesB) {
    if (prevStrikesA === -1 || prevStrikesB === -1) {
        prevStrikesA = strikesA;
        prevStrikesB = strikesB;
        return;
    }

    if (strikesA === 3 && prevStrikesA < 3) {
        // Team A got 3 strikes, chance goes to Team B
        showChanceMessage("B");
    } else if (strikesB === 3 && prevStrikesB < 3) {
        // Team B got 3 strikes, chance goes to Team A
        showChanceMessage("A");
    }
    prevStrikesA = strikesA;
    prevStrikesB = strikesB;
}

function showChanceMessage(chanceTeam) {
    const oppName = chanceTeam === "A"
        ? (document.getElementById("teamAName") ? document.getElementById("teamAName").textContent : "TEAM A")
        : (document.getElementById("teamBName") ? document.getElementById("teamBName").textContent : "TEAM B");

    const overlay = document.getElementById("chanceOverlay");
    const text = document.getElementById("chanceMessageText");
    const buzzer = document.getElementById("buzzerSound");

    if (overlay && text) {
        text.textContent = `CHANCE TO ${oppName}!`;
        overlay.style.display = "flex";

        if (buzzer) {
            buzzer.currentTime = 0;
            buzzer.play().catch(e => console.log("Audio play failed:", e));
        }

        setTimeout(() => {
            overlay.style.display = "none";
        }, 4000);
    }
}

socket.on("strikeUpdate", (strikes) => {
    updateStrikesDisplay("A", strikes.teamA);
    updateStrikesDisplay("B", strikes.teamB);
    handleStrikesChanged(strikes.teamA, strikes.teamB);
});

function updateStrikesDisplay(team, count) {
    const element = document.getElementById(`strikes${team}`);
    if (!element) return;

    let strikeHTML = "";

    for (let i = 0; i < 3; i++) {
        if (i < count) {
            strikeHTML += '<span class="strike filled">✕</span>';
        } else {
            strikeHTML += '<span class="strike empty">○</span>';
        }
    }

    element.innerHTML = strikeHTML;
}

/* -----------------------------
   ANSWER REVEAL
------------------------------*/
socket.on("answerRevealed", (data) => {
    const board = document.getElementById("answerBoard");
    if (!board) return;

    const boxes = board.querySelectorAll(".answer-box");

    for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].classList.contains("placeholder")) {
            boxes[i].classList.remove("placeholder");

            boxes[i].innerHTML = `
                <div class="answer-text">${data.answer.answer}</div>
                <div class="answer-points">${data.answer.weight} pts</div>
            `;

            boxes[i].style.animation = "slideIn 0.5s ease-out";
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
        console.error("Error playing buzzer:", error);
    }
}

/* -----------------------------
   TIMER UPDATE
------------------------------*/
socket.on("timerUpdate", (seconds) => {

    const timerDisplay = document.getElementById("timerDisplay");
    if (!timerDisplay) return;

    timerDisplay.style.display = "block";

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    timerDisplay.textContent =
        `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    if (seconds <= 10 && seconds > 0) {
        timerDisplay.style.color = "#ff1744";
    } else {
        timerDisplay.style.color = "#ffd700";
    }
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

    if (show) {
        gameScreen.style.display = "none";
        thankYouScreen.style.display = "flex";
    } else {
        gameScreen.style.display = "block";
        thankYouScreen.style.display = "none";
    }
});

/* -----------------------------
   STATE SYNC
------------------------------*/
socket.on("stateUpdate", (state) => {

    const teamA = document.getElementById("teamAName");
    const teamB = document.getElementById("teamBName");

    const scoreA = document.getElementById("teamAScore");
    const scoreB = document.getElementById("teamBScore");

    if (teamA) teamA.textContent = state.teamA.name;
    if (teamB) teamB.textContent = state.teamB.name;

    if (scoreA) scoreA.textContent = state.teamA.score;
    if (scoreB) scoreB.textContent = state.teamB.score;

    updateStrikesDisplay("A", state.teamA.strikes);
    updateStrikesDisplay("B", state.teamB.strikes);

    handleStrikesChanged(state.teamA.strikes, state.teamB.strikes);

    if (state.revealedAnswers.length === 0) {
        resetAnswerBoard();
    }
});

/* -----------------------------
   RESET ANSWER BOARD
------------------------------*/
function resetAnswerBoard() {

    const board = document.getElementById("answerBoard");
    if (!board) return;

    board.innerHTML = "";

    for (let i = 0; i < 8; i++) {
        const box = document.createElement("div");
        box.className = "answer-box placeholder";
        box.textContent = "?";
        board.appendChild(box);
    }
}

/* -----------------------------
   SOCKET CONNECT
------------------------------*/
socket.on("connect", () => {
    console.log("Display connected to server");
});