const SUPABASE_URL = "https://yckzsnehkugfvecbwheq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_y2Tika1SdQUWXwyQKyB7AA_6sH2ef-g";


const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let alivePokemon = [];
let questions = [];
let questionVariables = [];
let currentQuestion = null;
let turnCount = 0;

const MAX_QUESTIONS = 20;
const askedQuestions = new Set();

async function initGame() {
  document.getElementById("question-text").innerText = "Downloading decision database...";
  turnCount = 0;
  askedQuestions.clear();
  
  const { data: pData, error: pErr } = await dbClient.from('pokemon').select('pokemon_id, name');
  if (pErr) console.error("Pokemon Fetch Error:", pErr);
  alivePokemon = pData || [];

  const { data: qData, error: qErr } = await dbClient.from('questions').select('*').eq('enabled_in_game', true);
  if (qErr) console.error("Questions Fetch Error:", qErr);
  questions = qData || [];

  const { data: vData, error: vErr } = await dbClient.from('question_variables').select('*');
  if (vErr) console.error("Variables Fetch Error:", vErr);
  questionVariables = vData || [];

  document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
  nextQuestion();
}

async function nextQuestion() {
  turnCount++;

  // Guess triggers: candidate count <= 1, max questions reached, or <= 3 candidates after turn 12
  if (alivePokemon.length <= 1 || turnCount > MAX_QUESTIONS || (alivePokemon.length <= 3 && turnCount >= 12)) {
    makeGuess();
    return;
  }

  // Build a pool of unasked, valid questions
  const validQuestions = [];
  for (const q of questions) {
    if (q.variable_category !== 'none') {
      const matchingVars = questionVariables.filter(v => v.category === q.variable_category);
      for (const v of matchingVars) {
        const key = `${q.question_id}_${v.variable_value}`;
        if (!askedQuestions.has(key)) {
          validQuestions.push({ question: q, variable: v, key });
        }
      }
    } else {
      const key = `${q.question_id}_none`;
      if (!askedQuestions.has(key)) {
        validQuestions.push({ question: q, variable: null, key });
      }
    }
  }

  if (validQuestions.length === 0) {
    makeGuess();
    return;
  }

  // Pick a random valid question from the filtered list
  const selected = validQuestions[Math.floor(Math.random() * validQuestions.length)];
  askedQuestions.add(selected.key);

  let displayText = selected.question.template_text;
  let varVal = "none";

  if (selected.variable) {
    varVal = selected.variable.variable_value;
    displayText = displayText.replace("{value}", selected.variable.display_name);
  }

  currentQuestion = { question_id: selected.question.question_id, variable_value: varVal };
  document.getElementById("question-text").innerText = `[Q${turnCount}] ${displayText}`;
}

function makeGuess() {
  const winner = alivePokemon.length > 0 ? alivePokemon[0].name.toUpperCase() : "UNKNOWN";
  document.getElementById("game-area").innerHTML = `
    <div class="guess-box">I guess: ${winner}!</div>
    <button onclick="location.reload()" style="margin-top: 1.5rem;">Play Again</button>
  `;
}

async function submitAnswer(userChoice) {
  if (!currentQuestion) return;

  const { data: tallyData, error: tErr } = await dbClient
    .from('pokemon_question_tallies')
    .select('pokemon_id, yes_count, no_count')
    .eq('question_id', currentQuestion.question_id)
    .eq('variable_value', currentQuestion.variable_value);

  if (tErr) console.error("Tally Fetch Error:", tErr);

  if (tallyData && userChoice !== 'dont_know') {
    const targetMap = new Map(tallyData.map(t => [t.pokemon_id, t]));

    alivePokemon = alivePokemon.filter(p => {
      const tally = targetMap.get(p.pokemon_id);
      if (!tally) return true;

      const total = tally.yes_count + tally.no_count;
      const yesRatio = total > 0 ? tally.yes_count / total : 0.5;
      return userChoice === 'yes' ? yesRatio >= 0.5 : yesRatio < 0.5;
    });
  }

  document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
  nextQuestion();
}

initGame();

  if (questions.length === 0) {
    document.getElementById("question-text").innerText = "Error loading question bank.";
    return;
  }

  // Pick a random question template for prototyping
  const randomQ = questions[Math.floor(Math.random() * questions.length)];
  let varVal = "none";
  let displayText = randomQ.template_text;

  if (randomQ.variable_category !== 'none') {
    const matchingVars = questionVariables.filter(v => v.category === randomQ.variable_category);
    if (matchingVars.length > 0) {
      const selectedVar = matchingVars[Math.floor(Math.random() * matchingVars.length)];
      varVal = selectedVar.variable_value;
      displayText = displayText.replace("{value}", selectedVar.display_name);
    }
  }

  currentQuestion = { question_id: randomQ.question_id, variable_value: varVal };
  document.getElementById("question-text").innerText = displayText;
}

async function submitAnswer(userChoice) {
  if (!currentQuestion) return;

  // Query tallies matching this question using dbClient
  const { data: tallyData, error: tErr } = await dbClient
    .from('pokemon_question_tallies')
    .select('pokemon_id, yes_count, no_count')
    .eq('question_id', currentQuestion.question_id)
    .eq('variable_value', currentQuestion.variable_value);

  if (tErr) console.error("Tally Fetch Error:", tErr);

  if (tallyData && userChoice !== 'dont_know') {
    const targetMap = new Map(tallyData.map(t => [t.pokemon_id, t]));

    // Filter alive Pokemon based on user answer
    alivePokemon = alivePokemon.filter(p => {
      const tally = targetMap.get(p.pokemon_id);
      if (!tally) return true; // Keep if no data recorded

      const total = tally.yes_count + tally.no_count;
      const yesRatio = total > 0 ? tally.yes_count / total : 0.5;
      return userChoice === 'yes' ? yesRatio >= 0.5 : yesRatio < 0.5;
    });
  }

  document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
  nextQuestion();
}

initGame();
