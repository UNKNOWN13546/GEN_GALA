const socket = io();

let currentQuestion = null;
let currentRound = null;
let allQuestions = [];
let currentIndex = 0;
let revealedAnswers = new Set();

const QUALIFY_SCORE_R1R2 = 150;


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

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to load question file: ${response.statusText}`);
            }

            const data = await response.json();

            allQuestions = [];

            /* SUPPORT MULTIPLE JSON FORMATS */

            if (Array.isArray(data?.sets)) {

                data.sets.forEach(set => {
                    if (Array.isArray(set.questions)) {
                        allQuestions = allQuestions.concat(set.questions);
                    }
                });

            }

            if (Array.isArray(data?.matches)) {

                data.matches.forEach(match => {
                    if (Array.isArray(match.questions)) {
                        allQuestions = allQuestions.concat(match.questions);
                    }
                });

            }

            if (Array.isArray(data?.questions)) {
                allQuestions = allQuestions.concat(data.questions);
            }

            /* RESET ROUND STATE */

            currentRound = round;
            currentIndex = 0;
            currentQuestion = null;
            revealedAnswers.clear();

            socket.emit("loadQuestions", { questions: allQuestions });
            socket.emit("roundChanged", { round: currentRound });

            if (allQuestions.length) {
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
TEAM MANAGEMENT
===================================================== */

function updateTeams() {

    const teamA = document.getElementById("teamA")?.value || "Team A";
    const teamB = document.getElementById("teamB")?.value || "Team B";

    socket.emit("updateTeams", { teamA, teamB });

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

socket.on("stateUpdate", (state) => {

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

});


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