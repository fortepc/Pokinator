const SUPABASE_URL = "https://yckzsnehkugfvecbwheq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_y2Tika1SdQUWXwyQKyB7AA_6sH2ef-g";

const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let alivePokemon = [];
let questions = [];
let questionVariables = [];
let currentQuestion = null;
let currentGuess = null;
let turnCount = 0;
let maxQuestionsThreshold = 25;

const askedQuestions = new Set();

// Paginated fetch to bypass Supabase's default 1,000-row API cap
async function fetchAllPokemon() {
  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await dbClient
      .from('pokemon')
      .select('pokemon_id, name')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error || !data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return allRows;
}

// Paginated tally fetch
async function fetchTalliesForQuestion(questionId, varVal) {
  let allTallies = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await dbClient
      .from('pokemon_question_tallies')
      .select('pokemon_id, yes_count, no_count')
      .eq('question_id', questionId)
      .eq('variable_value', varVal)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error || !data || data.length === 0) break;
    allTallies = allTallies.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return allTallies;
}

async function initGame() {
  restoreGameUI();
  document.getElementById("question-text").innerText = "Downloading decision database...";
  turnCount = 0;
  maxQuestionsThreshold = 25;
  askedQuestions.clear();
  
  // Fetch ALL Pokemon (bypasses 1,000 row cap)
  alivePokemon = await fetchAllPokemon();

  // Fetch enabled questions
  const { data: qData, error: qErr } = await dbClient.from('questions').select('*').eq('enabled_in_game', true);
  if (qErr) console.error("Questions Fetch Error:", qErr);
  questions = qData || [];

  // Fetch variables
  const { data: vData, error: vErr } = await dbClient.from('question_variables').select('*');
  if (vErr) console.error("Variables Fetch Error:", vErr);
  questionVariables = vData || [];

  document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
  nextQuestion();
}

function restoreGameUI() {
  document.getElementById("game-area").innerHTML = `
    <h2 id="question-text">Analyzing candidate entropy...</h2>
    <div id="button-group">
      <button onclick="submitAnswer('yes')">Yes</button>
      <button onclick="submitAnswer('no')">No</button>
      <button onclick="submitAnswer('dont_know')">Don't Know</button>
    </div>
  `;
}

async function nextQuestion() {
  turnCount++;

  // Trigger guess if 1 candidate remains or question threshold is reached
  if (alivePokemon.length <= 1 || turnCount > maxQuestionsThreshold) {
    makeGuess();
    return;
  }

  document.getElementById("question-text").innerText = "Analyzing candidate entropy...";

  // 1. Group unasked variables by Question Template
  const availableTemplates = [];
  for (const q of questions) {
    const unusedVars = [];
    if (q.variable_category !== 'none') {
      const matchingVars = questionVariables.filter(v => v.category === q.variable_category);
      for (const v of matchingVars) {
        const key = `${q.question_id}_${v.variable_value}`;
        if (!askedQuestions.has(key)) {
          unusedVars.push(v);
        }
      }
    } else {
      const key = `${q.question_id}_none`;
      if (!askedQuestions.has(key)) {
        unusedVars.push(null);
      }
    }

    if (unusedVars.length > 0) {
      availableTemplates.push({ question: q, unusedVars });
    }
  }

  if (availableTemplates.length === 0) {
    makeGuess();
    return;
  }

  // 2. Sample across DISTINCT question templates
  const sampledTemplates = availableTemplates.sort(() => 0.5 - Math.random()).slice(0, 15);

  const candidatePairs = [];
  for (const item of sampledTemplates) {
    const varsToTest = item.unusedVars.sort(() => 0.5 - Math.random()).slice(0, 2);
    for (const v of varsToTest) {
      candidatePairs.push({
        question: item.question,
        variable: v,
        key: `${item.question.question_id}_${v ? v.variable_value : 'none'}`
      });
    }
  }

  // 3. Parallelize tally queries and evaluate split balance
  const currentAliveIds = new Set(alivePokemon.map(p => p.pokemon_id));

  const evaluations = await Promise.all(
    candidatePairs.map(async (candidate) => {
      const varVal = candidate.variable ? candidate.variable.variable_value : "none";
      const tallyData = await fetchTalliesForQuestion(candidate.question.question_id, varVal);

      if (!tallyData || tallyData.length === 0) {
        return { candidate, score: Infinity, tallyData: null };
      }

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

      // Ignore questions that do not eliminate any alive candidates
      if (yesCount === 0 || noCount === 0) {
        return { candidate, score: Infinity, tallyData };
      }

      return {
        candidate,
        score: Math.abs(yesCount - noCount),
        tallyData
      };
    })
  );

  const validEvals = evaluations.filter(e => e.score !== Infinity);

  let bestQuestion = null;
  let bestTallyData = null;

  if (validEvals.length > 0) {
    let best = validEvals.reduce((prev, curr) => (curr.score < prev.score ? curr : prev));
    bestQuestion = best.candidate;
    bestTallyData = best.tallyData;
  } else {
    bestQuestion = candidatePairs[Math.floor(Math.random() * candidatePairs.length)];
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
  if (alivePokemon.length === 0) {
    document.getElementById("game-area").innerHTML = `
      <div class="guess-box">I'm stumped! I don't know this Pokémon.</div>
      <button onclick="initGame()" style="margin-top: 1.5rem;">Play Again</button>
    `;
    return;
  }

  currentGuess = alivePokemon[0];
  document.getElementById("game-area").innerHTML = `
    <div style="font-size: 1.2rem; margin-bottom: 1rem;">Is your Pokémon...</div>
    <div class="guess-box" style="font-size: 1.8rem; color: #3b82f6; text-transform: uppercase;">
      ${currentGuess.name.replace(/-/g, ' ')}?
    </div>
    <div style="margin-top: 1.5rem;">
      <button onclick="handleGuessResult(true)">Yes, that's it!</button>
      <button onclick="handleGuessResult(false)">No, keep guessing</button>
    </div>
  `;
}

async function handleGuessResult(isCorrect) {
  if (isCorrect) {
    document.getElementById("game-area").innerHTML = `
      <div class="guess-box" style="color: #4ade80;">I guessed it in ${turnCount} questions!</div>
      <button onclick="initGame()" style="margin-top: 1.5rem;">Play Again</button>
    `;
  } else {
    // Remove rejected candidate
    alivePokemon = alivePokemon.filter(p => p.pokemon_id !== currentGuess.pokemon_id);
    document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
    
    if (alivePokemon.length === 0) {
      document.getElementById("game-area").innerHTML = `
        <div class="guess-box" style="color: #ef4444;">I ran out of candidates! You win!</div>
        <button onclick="initGame()" style="margin-top: 1.5rem;">Play Again</button>
      `;
    } else {
      // Extend question phase by 5 turns before guessing again
      maxQuestionsThreshold = turnCount + 5;
      restoreGameUI();
      nextQuestion();
    }
  }
}

async function submitAnswer(userChoice) {
  if (!currentQuestion) return;

  let tallyData = currentQuestion.cachedTally;

  if (!tallyData) {
    tallyData = await fetchTalliesForQuestion(currentQuestion.question_id, currentQuestion.variable_value);
  }

  if (tallyData && tallyData.length > 0 && userChoice !== 'dont_know') {
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
