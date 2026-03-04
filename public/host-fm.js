const socket = io();

let fmQuestions = [];
let currentQuestionIndex = -1;
let currentQuestion = null;
let revealedAnswers = []; // array of {answer, team, playerIndex}
let timerInterval = null;
let currentActivePlayer = 'none'; // tracked from server state

// Load FM questions on startup
fetch('/questions/fm_questions.json')
    .then(r => r.json())
    .then(data => {
        // Handle different JSON structures: { questions: [...] } or { sets: [{ questions: [...] }] }
        if (data.sets && data.sets.length > 0) {
            // Flatten all questions from all sets into one single array
            fmQuestions = data.sets.flatMap(set => set.questions);
        } else if (data.questions) {
            fmQuestions = data.questions;
        } else {
            console.error('Unknown question format:', data);
            fmQuestions = [];
        }
        populateQuestionSelector();
    })
    .catch(err => console.error('Error loading FM questions:', err));

// Populate question selector
function populateQuestionSelector() {
    const selector = document.getElementById('questionSelector');
    selector.innerHTML = '<option value="">Select a question...</option>';
    fmQuestions.forEach((q, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        option.textContent = `Q${q.question_number}: ${q.question}`;
        selector.appendChild(option);
    });
}

// Select and display question
function selectQuestion() {
    const idx = parseInt(document.getElementById('questionSelector').value);
    if (isNaN(idx)) return;

    currentQuestionIndex = idx;
    currentQuestion = fmQuestions[idx];
    revealedAnswers = [];

    displayQuestion();
}

function displayQuestion() {
    if (!currentQuestion) return;

    document.getElementById('questionText').textContent = currentQuestion.question;

    const answersList = document.getElementById('answersList');
    answersList.innerHTML = '';

    currentQuestion.answers.forEach((answer) => {
        // Find if this answer was already revealed and who revealed it
        const revealedData = revealedAnswers.find(r => r.answer === answer.answer);
        const isRevealed = !!revealedData;

        // If Team A or Team B already revealed this, disable all buttons to prevent duplicates
        // Because Format 2 demands you CANNOT use the same answer twice for the same question.

        const answerRow = document.createElement('div');
        answerRow.className = `answer-row ${isRevealed ? 'revealed' : ''}`;

        const btnHtml = isRevealed ?
            `<div style="color: #ff1744; font-weight: bold;">Already selected by ${revealedData.team}${revealedData.playerIndex + 1}</div>`
            :
            `
                <button class="btn btn-small btn-team-a" onclick="revealAnswer('A', 0, '${answer.answer}', ${answer.weight})">A1</button>
                <button class="btn btn-small btn-team-a" onclick="revealAnswer('A', 1, '${answer.answer}', ${answer.weight})">A2</button>
                <button class="btn btn-small btn-team-b" onclick="revealAnswer('B', 0, '${answer.answer}', ${answer.weight})">B1</button>
                <button class="btn btn-small btn-team-b" onclick="revealAnswer('B', 1, '${answer.answer}', ${answer.weight})">B2</button>
            `;

        answerRow.innerHTML = `
            <div class="answer-text">${answer.answer} <span class="answer-weight">(${answer.weight})</span></div>
            <div class="answer-buttons">
                ${btnHtml}
            </div>
        `;
        answersList.appendChild(answerRow);
    });
}

function revealAnswer(team, playerIndex, answerText, weight) {
    if (currentActivePlayer === 'none') {
        alert('⚠️ Please select an Active Player first before revealing answers!');
        return;
    }
    revealedAnswers.push({ answer: answerText, team: team, playerIndex: playerIndex });
    socket.emit('revealAnswer', {
        team: team,
        playerIndex: playerIndex,
        answer: {
            answer: answerText,
            weight: weight
        }
    });
    displayQuestion();

    // Auto-advance to next question after a short delay
    setTimeout(() => {
        nextQuestion();
    }, 600);
}

/* -----------------------------
   STRIKES
------------------------------*/
function addStrike(team) {
    socket.emit("addStrike", { team });
}

function resetStrikes() {
    socket.emit("resetStrikes");
}

function updatePlayers() {
    const teamA = document.getElementById('teamA').value || 'Team A';
    const teamB = document.getElementById('teamB').value || 'Team B';
    const playersA = [
        document.getElementById('playerA1').value || 'Player A1',
        document.getElementById('playerA2').value || 'Player A2'
    ];
    const playersB = [
        document.getElementById('playerB1').value || 'Player B1',
        document.getElementById('playerB2').value || 'Player B2'
    ];

    socket.emit('updateTeams', { teamA, teamB });
    socket.emit('updatePlayers', { playersA, playersB });
}

function setActivePlayer() {
    const player = document.getElementById('activePlayerSelector').value;
    socket.emit('setActivePlayer', { player });

    // Auto-clear the board when switching to a real player
    // so their run always starts on a clean blank board
    if (player !== 'none') {
        revealedAnswers = [];
        socket.emit('clearBoard');
    }
}

function nextQuestion() {
    if (currentQuestionIndex < fmQuestions.length - 1) {
        currentQuestionIndex++;
        currentQuestion = fmQuestions[currentQuestionIndex];
        // Sync the dropdown to match
        document.getElementById('questionSelector').value = currentQuestionIndex;
        displayQuestion();
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        currentQuestion = fmQuestions[currentQuestionIndex];
        // Sync the dropdown to match
        document.getElementById('questionSelector').value = currentQuestionIndex;
        displayQuestion();
    }
}

function clearBoard() {
    revealedAnswers = [];   // reset host-side tracking too
    socket.emit('clearBoard');
}

function markCross() {
    if (currentActivePlayer === 'none') {
        alert('⚠️ Please select an Active Player first!');
        return;
    }
    socket.emit('markCross');
    setTimeout(() => {
        nextQuestion();
    }, 600);
}

function revealTotal(team) {
    socket.emit('revealTotal', { team });
}

function addScore(team, playerIndex) {
    const points = parseInt(document.getElementById('pointsInput').value) || 0;
    if (points > 0) {
        socket.emit('addScore', { team, playerIndex, points });
    }
}

function startTimer() {
    const duration = parseInt(document.getElementById('timerInput').value) || 60;
    socket.emit('startTimer', { duration });
}

function stopTimer() {
    socket.emit('stopTimer');
}

function resetTimer() {
    socket.emit('resetTimer');
    document.getElementById('timerDisplay').textContent = '00:00';
}

function showThankYou() {
    if (confirm('End the game and show Thank You screen?')) {
        socket.emit('showThankYou');
    }
}

function resetGame() {
    if (confirm("Are you sure you want to completely reset the game? All scores and strikes will be wiped.")) {
        socket.emit("resetGame");
        revealedAnswers = [];
        document.getElementById("pointsInput").value = "0";
    }
}

// Socket events
socket.on('timerUpdate', (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('timerDisplay').textContent =
        `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
});

socket.on('scoreUpdate', (scores) => {
    document.getElementById('scoreA').value = scores.teamA;
    document.getElementById('scoreB').value = scores.teamB;
});

socket.on('stateUpdate', (state) => {
    document.getElementById('scoreA').value = state.teamA.score;
    document.getElementById('scoreB').value = state.teamB.score;
    // Track active player for guard checks
    currentActivePlayer = state.activePlayer || 'none';
    // Update the dropdown to reflect server state
    const sel = document.getElementById('activePlayerSelector');
    if (sel && sel.value !== state.activePlayer) {
        sel.value = state.activePlayer || 'none';
    }
});

function showTeamScore(team) {
    socket.emit('showTeamScore', { team });
}

function showWinner() {
    socket.emit('showWinner');
}

function hideRevealScreen() {
    socket.emit('hideRevealScreen');
}

socket.on('connect', () => {
    console.log('Connected to FM Host server');
});