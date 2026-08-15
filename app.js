const SUPABASE_URL = "https://yckzsnehkugfvecbwheq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_y2Tika1SdQUWXwyQKyB7AA_6sH2ef-g";

const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let alivePokemon = [];
let allPokemonMasterList = [];
let questions = [];
let questionVariables = [];
let currentQuestion = null;
let currentGuess = null;
let turnCount = 0;
let maxQuestionsThreshold = 25;

const askedQuestions = new Set();
const sessionHistory = []; // Stores { question_id, variable_value, userChoice }

// Paginated fetch to bypass Supabase's default 1,000-row API cap
async function fetchAllPokemon() {
  console.log("🌐 [Init] Starting paginated fetch for master Pokémon list...");
  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await dbClient
      .from('pokemon')
      .select('pokemon_id, name')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    
    if (error) {
      console.error(`❌ [Init] Fetch error on page ${page}:`, error);
      break;
    }
    if (!data || data.length === 0) break;
    
    allRows = allRows.concat(data);
    console.log(`📦 [Init] Loaded page ${page + 1} (${data.length} items). Total so far: ${allRows.length}`);
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
  sessionHistory.length = 0;
  
  console.log("🚀 [Game Start] Initializing game session...");
  allPokemonMasterList = await fetchAllPokemon();
  alivePokemon = [...allPokemonMasterList];

  const { data: qData, error: qErr } = await dbClient.from('questions').select('*').eq('enabled_in_game', true);
  if (qErr) console.error("❌ [Init] Questions Fetch Error:", qErr);
  questions = qData || [];

  const { data: vData, error: vErr } = await dbClient.from('question_variables').select('*');
  if (vErr) console.error("❌ [Init] Variables Fetch Error:", vErr);
  questionVariables = vData || [];

  console.log(`✅ [Init Complete] ${alivePokemon.length} candidate Pokémon, ${questions.length} question templates loaded.`);
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
  console.log(`\n--- 🔄 [Turn ${turnCount}] Alive Candidates: ${alivePokemon.length} ---`);

  if (alivePokemon.length <= 1 || turnCount > maxQuestionsThreshold) {
    console.log("🎯 [Decision] Candidate count threshold met. Triggering guess phase.");
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
        if (!askedQuestions.has(key)) unusedVars.push(v);
      }
    } else {
      const key = `${q.question_id}_none`;
      if (!askedQuestions.has(key)) unusedVars.push(null);
    }

    if (unusedVars.length > 0) {
      availableTemplates.push({ question: q, unusedVars });
    }
  }

  if (availableTemplates.length === 0) {
    console.log("⚠️ [Entropy] No unused questions left. Forcing guess.");
    makeGuess();
    return;
  }

  // 2. Sample distinct question templates
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

  console.log(`📊 [Entropy] Testing ${candidatePairs.length} question candidates across ${sampledTemplates.length} categories...`);

  // 3. Evaluate split efficiency
  const currentAliveIds = new Set(alivePokemon.map(p => p.pokemon_id));

  const evaluations = await Promise.all(
    candidatePairs.map(async (candidate) => {
      const varVal = candidate.variable ? candidate.variable.variable_value : "none";
      const tallyData = await fetchTalliesForQuestion(candidate.question.question_id, varVal);

      if (!tallyData || tallyData.length === 0) {
        return { candidate, score: Infinity, tallyData: null, yesCount: 0, noCount: 0 };
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

      if (yesCount === 0 || noCount === 0) {
        return { candidate, score: Infinity, tallyData, yesCount, noCount };
      }

      return {
        candidate,
        score: Math.abs(yesCount - noCount),
        tallyData,
        yesCount,
        noCount
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
    console.log(`💡 [Selected Question] "Q${bestQuestion.question.question_id}: ${bestQuestion.question.template_text}" (Variable: ${bestQuestion.variable ? bestQuestion.variable.variable_value : 'none'}) | Split Projection -> YES: ${best.yesCount}, NO: ${best.noCount} | Imbalance Score: ${best.score}`);
  } else {
    bestQuestion = candidatePairs[Math.floor(Math.random() * candidatePairs.length)];
    console.log(`⚠️ [Entropy Fallback] No perfect split found. Selected fallback question: Q${bestQuestion.question.question_id}`);
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
    promptForCorrectPokemon("I ran out of candidates!");
    return;
  }

  currentGuess = alivePokemon[0];
  console.log(`🤔 [Guess Phase] Guessing: ${currentGuess.name.toUpperCase()} (ID: ${currentGuess.pokemon_id})`);
  
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
    console.log(`🎉 [Win] Successfully guessed ${currentGuess.name.toUpperCase()} in ${turnCount} turns!`);

    // Build RPC payload from session history to reinforce correct answers
    const payload = sessionHistory.map(entry => ({
      pokemon_id: currentGuess.pokemon_id,
      question_id: entry.question_id,
      variable_value: entry.variable_value,
      yes_count: entry.userChoice === 'yes' ? 10 : 0,
      no_count: entry.userChoice === 'no' ? 10 : 0
    }));

    if (payload.length > 0) {
      console.log(`⬆️ [Win Feedback] Reinforcing ${payload.length} tallies for ${currentGuess.name.toUpperCase()} in Supabase...`, payload);
      const { error } = await dbClient.rpc("add_tallies", { payload });
      if (error) {
        console.error("❌ [Database Error] Failed to update win tallies:", error);
      } else {
        console.log("✅ [Database Updated] Win tallies successfully saved!");
      }
    }

    document.getElementById("game-area").innerHTML = `
      <div class="guess-box" style="color: #4ade80;">I guessed it in ${turnCount} questions!</div>
      <p style="margin-top: 0.5rem; font-size: 0.9rem; color: #888;">Saved ${payload.length} answer tallies for ${currentGuess.name.toUpperCase()}.</p>
      <button onclick="initGame()" style="margin-top: 1.5rem;">Play Again</button>
    `;
  } else {
    console.log(`❌ [Incorrect Guess] User rejected ${currentGuess.name.toUpperCase()}. Removing candidate.`);
    alivePokemon = alivePokemon.filter(p => p.pokemon_id !== currentGuess.pokemon_id);
    document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
    
    if (alivePokemon.length === 0) {
      promptForCorrectPokemon("I ran out of candidates!");
    } else {
      maxQuestionsThreshold = turnCount + 5;
      console.log(`🔄 [Resuming Game] Questions threshold extended to ${maxQuestionsThreshold}. Asking more questions...`);
      restoreGameUI();
      nextQuestion();
    }
  }
}

function promptForCorrectPokemon(titleReason) {
  console.log("📝 [Feedback Prompt] Presenting Pokémon selection UI to update tallies...");
  
  // Sort list alphabetically for easier scrolling
  const sortedOptions = [...allPokemonMasterList].sort((a, b) => a.name.localeCompare(b.name));
  
  let optionsHTML = sortedOptions.map(p => `<option value="${p.pokemon_id}">${p.name.replace(/-/g, ' ').toUpperCase()}</option>`).join('');

  document.getElementById("game-area").innerHTML = `
    <div class="guess-box" style="color: #ef4444; margin-bottom: 1rem;">${titleReason}</div>
    <p style="margin-bottom: 1rem;">Which Pokémon were you thinking of?</p>
    <select id="pokemon-select" style="width: 80%; padding: 10px; border-radius: 6px; background: #2a2a2a; color: white; font-size: 1rem;">
      ${optionsHTML}
    </select>
    <br/>
    <button onclick="submitTargetPokemonCorrection()" style="margin-top: 1.5rem;">Submit & Update Database</button>
  `;
}

async function submitTargetPokemonCorrection() {
  const selectElem = document.getElementById("pokemon-select");
  const selectedPokemonId = parseInt(selectElem.value, 10);
  const selectedPokemonObj = allPokemonMasterList.find(p => p.pokemon_id === selectedPokemonId);
  const name = selectedPokemonObj ? selectedPokemonObj.name.toUpperCase() : "selected Pokémon";

  document.getElementById("game-area").innerHTML = `<div class="guess-box">Updating tallies for ${name}...</div>`;

  // Build RPC payload from session history
  const payload = sessionHistory.map(entry => ({
    pokemon_id: selectedPokemonId,
    question_id: entry.question_id,
    variable_value: entry.variable_value,
    yes_count: entry.userChoice === 'yes' ? 10 : 0,
    no_count: entry.userChoice === 'no' ? 10 : 0
  }));

  console.log(`⬆️ [Updating Database] Sending ${payload.length} tally updates for Pokémon ID ${selectedPokemonId} (${name}) via add_tallies RPC...`, payload);

  if (payload.length > 0) {
    const { error } = await dbClient.rpc("add_tallies", { payload });
    if (error) {
      console.error("❌ [Database Error] Failed to update tallies:", error);
    } else {
      console.log("✅ [Database Updated] Tallies successfully updated!");
    }
  }

  document.getElementById("game-area").innerHTML = `
    <div class="guess-box" style="color: #4ade80;">Thanks! Dexter has updated its database for ${name}.</div>
    <button onclick="initGame()" style="margin-top: 1.5rem;">Play Again</button>
  `;
}

async function submitAnswer(userChoice) {
  if (!currentQuestion) return;

  console.log(`👉 [User Answer] Question Q${currentQuestion.question_id} (${currentQuestion.variable_value}) -> Choice: ${userChoice.toUpperCase()}`);

  // Track in session history for database feedback
  if (userChoice !== 'dont_know') {
    sessionHistory.push({
      question_id: currentQuestion.question_id,
      variable_value: currentQuestion.variable_value,
      userChoice
    });
  }

  let tallyData = currentQuestion.cachedTally;

  if (!tallyData) {
    tallyData = await fetchTalliesForQuestion(currentQuestion.question_id, currentQuestion.variable_value);
  }

  if (tallyData && tallyData.length > 0 && userChoice !== 'dont_know') {
    const targetMap = new Map(tallyData.map(t => [t.pokemon_id, t]));
    const prevCount = alivePokemon.length;

    alivePokemon = alivePokemon.filter(p => {
      const tally = targetMap.get(p.pokemon_id);
      if (!tally) return true;

      const total = tally.yes_count + tally.no_count;
      const yesRatio = total > 0 ? tally.yes_count / total : 0.5;
      return userChoice === 'yes' ? yesRatio >= 0.5 : yesRatio < 0.5;
    });

    console.log(`📉 [Candidate Filter] Reduced alive candidates from ${prevCount} down to ${alivePokemon.length}.`);
  }

  document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
  nextQuestion();
}

initGame();
