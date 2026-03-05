const socket = io();

let fmQuestions = [];
let currentQuestionIndex = -1;
let currentQuestion = null;
let revealedAnswers = [];
let currentActivePlayer = 'none';


/* =====================================================
LOAD QUESTIONS
===================================================== */

fetch('/questions/fm_questions.json')
    .then(r => r.json())
    .then(data => {

        if (data?.sets?.length) {
            fmQuestions = data.sets.flatMap(set => set.questions || []);
        }
        else if (data?.questions) {
            fmQuestions = data.questions;
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

    displayQuestion();

}


/* =====================================================
DISPLAY QUESTION
===================================================== */

function displayQuestion(shouldBroadcast = true) {

    if (!currentQuestion) return;

    const qText = document.getElementById('questionText');
    const answersList = document.getElementById('answersList');

    if (qText) qText.textContent = currentQuestion.question;

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
PLAYERS & TEAM SETUP
===================================================== */

function updatePlayers() {

    const teamA = document.getElementById('teamA')?.value || 'Team A';

    const playersA = [
        document.getElementById('playerA1')?.value || 'Player 1',
        document.getElementById('playerA2')?.value || 'Player 2'
    ];

    socket.emit('updateTeams', { teamA, teamB: teamA });
    socket.emit('updatePlayers', { playersA, playersB: playersA });

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


socket.on('stateUpdate', (state) => {

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

});


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