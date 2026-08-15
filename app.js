const SUPABASE_URL = "https://yckzsnehkugfvecbwheq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_y2Tika1SdQUWXwyQKyB7AA_6sH2ef-g"; // Use the public anon key here!

// Create the client instance under 'dbClient'
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let alivePokemon = [];
let questions = [];
let questionVariables = [];
let currentQuestion = null;

async function initGame() {
  document.getElementById("question-text").innerText = "Downloading decision database...";
  
  // 1. Fetch all Pokemon IDs using dbClient
  const { data: pData, error: pErr } = await dbClient.from('pokemon').select('pokemon_id, name');
  if (pErr) console.error("Pokemon Fetch Error:", pErr);
  alivePokemon = pData || [];

  // 2. Fetch all Question templates using dbClient
  const { data: qData, error: qErr } = await dbClient.from('questions').select('*').eq('enabled_in_game', true);
  if (qErr) console.error("Questions Fetch Error:", qErr);
  questions = qData || [];

  // 3. Fetch variables using dbClient
  const { data: vData, error: vErr } = await dbClient.from('question_variables').select('*');
  if (vErr) console.error("Variables Fetch Error:", vErr);
  questionVariables = vData || [];

  document.getElementById("candidate-count").innerText = `Alive Candidates: ${alivePokemon.length}`;
  nextQuestion();
}

async function nextQuestion() {
  if (alivePokemon.length <= 1) {
    const winner = alivePokemon[0] ? alivePokemon[0].name.toUpperCase() : "Unknown";
    document.getElementById("game-area").innerHTML = `<div class="guess-box">I guess: ${winner}!</div>`;
    return;
  }

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
