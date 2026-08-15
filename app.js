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
  
  // 1. Fetch all Pokemon
  const { data: pData, error: pErr } = await dbClient.from('pokemon').select('pokemon_id, name');
  if (pErr) console.error("Pokemon Fetch Error:", pErr);
  alivePokemon = pData || [];

  // 2. Fetch enabled questions
  const { data: qData, error: qErr } = await dbClient.from('questions').select('*').eq('enabled_in_game', true);
  if (qErr) console.error("Questions Fetch Error:", qErr);
  questions = qData || [];

  // 3. Fetch variables
  const { data: vData, error: vErr } = await dbClient.from('question_variables').select('*');
  if (vErr) console.error("Variables Fetch Error:", vErr);
  questionVariables = vData || [];

  document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
  nextQuestion();
}

async function nextQuestion() {
  turnCount++;

  // Guess triggers: candidate count <= 1, max questions reached, or <= 3 candidates after turn 10
  if (alivePokemon.length <= 1 || turnCount > MAX_QUESTIONS || (alivePokemon.length <= 3 && turnCount >= 10)) {
    makeGuess();
    return;
  }

  document.getElementById("question-text").innerText = "Analyzing candidate entropy...";

  // 1. Build list of all unasked question candidates
  const unaskedCandidates = [];
  for (const q of questions) {
    if (q.variable_category !== 'none') {
      const matchingVars = questionVariables.filter(v => v.category === q.variable_category);
      for (const v of matchingVars) {
        const key = `${q.question_id}_${v.variable_value}`;
        if (!askedQuestions.has(key)) {
          unaskedCandidates.push({ question: q, variable: v, key });
        }
      }
    } else {
      const key = `${q.question_id}_none`;
      if (!askedQuestions.has(key)) {
        unaskedCandidates.push({ question: q, variable: null, key });
      }
    }
  }

  if (unaskedCandidates.length === 0) {
    makeGuess();
    return;
  }

  // 2. Sample candidate questions to evaluate split efficiency
  const sampleSize = Math.min(unaskedCandidates.length, 30);
  const shuffled = unaskedCandidates.sort(() => 0.5 - Math.random()).slice(0, sampleSize);

  let bestQuestion = null;
  let bestScore = Infinity; // Lower score = closer to an even 50/50 split
  let bestTallyData = null;

  const currentAliveIds = new Set(alivePokemon.map(p => p.pokemon_id));

  for (const candidate of shuffled) {
    const varVal = candidate.variable ? candidate.variable.variable_value : "none";

    const { data: tallyData } = await dbClient
      .from('pokemon_question_tallies')
      .select('pokemon_id, yes_count, no_count')
      .eq('question_id', candidate.question.question_id)
      .eq('variable_value', varVal);

    if (!tallyData) continue;

    // Count how many currently alive Pokemon would answer YES vs NO
    let yesCount = 0;
    let noCount = 0;

    for (const tally of tallyData) {
      if (currentAliveIds.has(tally.pokemon_id)) {
        const total = tally.yes_count + tally.no_count;
        if (total > 0 && (tally.yes_count / total) >= 0.5) {
          yesCount++;
        } else {
          noCount++;
        }
      }
    }

    // Split balance score: |yesCount - noCount| (0 is a perfect 50/50 split)
    const score = Math.abs(yesCount - noCount);

    if (score < bestScore) {
      bestScore = score;
      bestQuestion = candidate;
      bestTallyData = tallyData;
    }
  }

  // Fallback if no tallies match
  if (!bestQuestion) {
    bestQuestion = unaskedCandidates[Math.floor(Math.random() * unaskedCandidates.length)];
  }

  askedQuestions.add(bestQuestion.key);

  let displayText = bestQuestion.question.template_text;
  let selectedVarVal = "none";

  if (bestQuestion.variable) {
    selectedVarVal = bestQuestion.variable.variable_value;
    displayText = displayText.replace("{value}", bestQuestion.variable.display_name);
  }

  currentQuestion = { 
    question_id: bestQuestion.question.question_id, 
    variable_value: selectedVarVal,
    cachedTally: bestTallyData 
  };

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

  let tallyData = currentQuestion.cachedTally;

  // Fetch tallies if not cached from entropy calculation
  if (!tallyData) {
    const { data, error: tErr } = await dbClient
      .from('pokemon_question_tallies')
      .select('pokemon_id, yes_count, no_count')
      .eq('question_id', currentQuestion.question_id)
      .eq('variable_value', currentQuestion.variable_value);

    if (tErr) console.error("Tally Fetch Error:", tErr);
    tallyData = data;
  }

  if (tallyData && userChoice !== 'dont_know') {
    const targetMap = new Map(tallyData.map(t => [t.pokemon_id, t]));

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
