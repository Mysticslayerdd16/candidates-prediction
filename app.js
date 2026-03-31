const { createClient } = supabase;
const cfg = window.APP_CONFIG || {};
const app = {
  supabase: null,
  user: null,
  profile: null,
  games: [],
  predictions: [],
  leaderboard: [],
  allProfiles: [],
  allPredictions: []
};

let currentPollsTournament = 'open';
let currentFixturesTournament = 'open';
let currentLeaderboardTournament = 'open';
let currentStandingsTournament = 'open';
let currentRoundPredictionsTournament = 'open';
let perfectRoundShownKey = null;

const qs = id => document.getElementById(id);
const show = el => el && el.classList.remove('hidden');
const hide = el => el && el.classList.add('hidden');

function esc(v = '') {
  return String(v).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function showToast(message) {
  const oldToast = document.getElementById('app-toast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = '#111827';
  toast.style.color = '#fff';
  toast.style.padding = '12px 18px';
  toast.style.borderRadius = '10px';
  toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.25)';
  toast.style.zIndex = '9999';
  toast.style.fontSize = '14px';
  toast.style.maxWidth = '90vw';
  toast.style.textAlign = 'center';

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function getISTNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date()).reduce((a, p) => {
    a[p.type] = p.value;
    return a;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function getGameStatus(game) {
  const now = getISTNow();

  if (now.date < game.game_date) return 'upcoming';
  if (now.date > game.game_date) return game.result ? 'completed' : 'locked';

  const mins = now.hour * 60 + now.minute;
  return mins < 18 * 60 ? 'open' : (game.result ? 'completed' : 'locked');
}

function getCountdownText(game) {
  const now = getISTNow();

  if (now.date < game.game_date) return 'Opens on game day';

  const nowMinutes = now.hour * 60 + now.minute;
  const closeMinutes = 17 * 60 + 59;

  if (now.date > game.game_date || nowMinutes > closeMinutes) {
    return game.result ? 'Result updated' : 'Locked';
  }

  const remaining = closeMinutes - nowMinutes;
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;

  return `Closes in ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

function labelStatus(s) {
  return ({
    upcoming: 'Upcoming',
    open: 'Open now',
    locked: 'Locked',
    completed: 'Completed'
  })[s] || s;
}

function labelResult(r) {
  return ({
    white_win: 'White win',
    draw: 'Draw',
    black_win: 'Black win'
  })[r] || '—';
}

function shortResultLabel(r, game) {
  if (r === 'white_win') return `${game.white_player} win`;
  if (r === 'black_win') return `${game.black_player} win`;
  if (r === 'draw') return 'Draw';
  return '—';
}

function predictionMap() {
  const m = new Map();
  app.predictions.forEach(p => m.set(p.game_id, p));
  return m;
}

async function ensureProfile(session) {
  const user = session?.user;
  if (!user) return null;

  const { data: existing, error: existingError } = await app.supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const displayName = (user.user_metadata?.display_name || '').trim();
  if (!displayName) throw new Error('Display name is missing.');

  const { data, error } = await app.supabase
    .from('profiles')
    .insert({
      id: user.id,
      email: user.email,
      display_name: displayName
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

function authMessage(msg, type = 'ok') {
  const el = qs('auth-message');
  if (!el) return;
  el.className = 'notice' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  show(el);
}

async function signUp() {
  const email = qs('signup-email')?.value.trim();
  const password = qs('signup-password')?.value.trim();
  const displayName = qs('signup-display-name')?.value.trim();

  if (!email || !password || !displayName) {
    return authMessage('Please fill all sign-up fields.', 'error');
  }

  const { data, error } = await app.supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });

  if (error) return authMessage(error.message, 'error');

  if (!data.session) {
    return authMessage('Turn off email confirmation in Supabase for instant sign-up.', 'error');
  }

  await ensureProfile(data.session);
  await boot();
}

async function signIn() {
  const email = qs('login-email')?.value.trim();
  const password = qs('login-password')?.value.trim();

  if (!email || !password) {
    return authMessage('Enter email and password.', 'error');
  }

  const { data, error } = await app.supabase.auth.signInWithPassword({ email, password });
  if (error) return authMessage(error.message, 'error');

  await ensureProfile(data.session);
  await boot();
}

async function signOut() {
  await app.supabase.auth.signOut();
  location.reload();
}

async function loadData() {
  const [
    { data: profile, error: profileError },
    { data: games, error: gamesError },
    { data: predictions, error: predictionsError },
    { data: profiles, error: profilesError },
    { data: allPreds, error: allPredsError }
  ] = await Promise.all([
    app.supabase.from('profiles').select('*').eq('id', app.user.id).single(),
    app.supabase.from('games').select('*').order('game_date').order('id'),
    app.supabase.from('predictions').select('*').eq('user_id', app.user.id),
    app.supabase.from('profiles').select('id, display_name'),
    app.supabase.from('predictions').select('user_id, game_id, prediction')
  ]);

  if (profileError) throw profileError;
  if (gamesError) throw gamesError;
  if (predictionsError) throw predictionsError;
  if (profilesError) throw profilesError;
  if (allPredsError) throw allPredsError;

  app.profile = profile;
  app.games = games || [];
  app.predictions = predictions || [];
  app.allProfiles = profiles || [];
  app.allPredictions = allPreds || [];
}

function buildLeaderboard(profiles, allPreds, games, tournament) {
  const filteredGames = games.filter(g => g.tournament === tournament);
  const gMap = new Map(filteredGames.map(g => [g.id, g]));
  const gameIds = new Set(filteredGames.map(g => g.id));

  return profiles.map(p => {
    let attempted = 0;
    let correct = 0;

    allPreds
      .filter(x => x.user_id === p.id && gameIds.has(x.game_id))
      .forEach(pred => {
        const game = gMap.get(pred.game_id);
        if (game && game.result) {
          attempted += 1;
          if (game.result === pred.prediction) correct += 1;
        }
      });

    const accuracy = attempted ? (correct / attempted) * 100 : 0;

    return {
      name: p.display_name,
      attempted,
      correct,
      accuracy
    };
  }).sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct || a.name.localeCompare(b.name));
}

function buildStandings(games, tournament) {
  const table = new Map();

  games
    .filter(g => g.tournament === tournament && g.result)
    .forEach(game => {
      const white = game.white_player;
      const black = game.black_player;

      if (!table.has(white)) table.set(white, { player: white, played: 0, wins: 0, draws: 0, losses: 0, points: 0 });
      if (!table.has(black)) table.set(black, { player: black, played: 0, wins: 0, draws: 0, losses: 0, points: 0 });

      const w = table.get(white);
      const b = table.get(black);

      w.played += 1;
      b.played += 1;

      if (game.result === 'white_win') {
        w.wins += 1;
        w.points += 1;
        b.losses += 1;
      } else if (game.result === 'black_win') {
        b.wins += 1;
        b.points += 1;
        w.losses += 1;
      } else if (game.result === 'draw') {
        w.draws += 1;
        b.draws += 1;
        w.points += 0.5;
        b.points += 0.5;
      }
    });

  return Array.from(table.values()).sort(
    (a, b) => b.points - a.points || b.wins - a.wins || a.player.localeCompare(b.player)
  );
}

function getRoundsForTournament(tournament) {
  return [...new Set(
    app.games
      .filter(g => g.tournament === tournament)
      .map(g => g.round_no)
  )].sort((a, b) => a - b);
}

function maybeShowPerfectRoundEgg(roundGames, roundCorrect, profile) {
  if (!app.user) return;
  if (profile.id !== app.user.id) return;
  if (!roundGames.length || roundCorrect !== roundGames.length) return;

  const key = `${currentRoundPredictionsTournament}-${roundGames[0].round_no}-${profile.id}`;
  if (perfectRoundShownKey === key) return;

  perfectRoundShownKey = key;
  showToast('♟ Perfect round. Candidate-level prep.');
}

function renderTop() {
  qs('app-title').textContent = cfg.APP_TITLE || 'Candidates 2026 Prediction League';
  qs('user-pill').textContent = app.profile.display_name;

  const isAdmin = !!app.profile.is_admin;
  qs('admin-pill')?.classList.toggle('hidden', !isAdmin);
  qs('admin-tab-btn')?.classList.toggle('hidden', !isAdmin);

  let total = 0;
  let finished = 0;
  let correct = 0;

  app.predictions.forEach(pred => {
    const game = app.games.find(g => g.id === pred.game_id);
    if (!game) return;
    total += 1;
    if (game.result) {
      finished += 1;
      if (game.result === pred.prediction) correct += 1;
    }
  });

  const acc = finished ? ((correct / finished) * 100).toFixed(2) : '0.00';

  qs('kpi-total').textContent = total;
  qs('kpi-finished').textContent = finished;
  qs('kpi-correct').textContent = correct;
  qs('kpi-accuracy').textContent = acc + '%';
}

function renderPolls() {
  const wrap = qs('polls-list');
  const msg = qs('polls-empty-message');
  if (!wrap || !msg) return;

  wrap.innerHTML = '';
  hide(msg);

  const map = predictionMap();
  const openGames = app.games.filter(g => g.tournament === currentPollsTournament && getGameStatus(g) === 'open');

  if (!openGames.length) {
    msg.textContent = 'No open polls right now. Check Fixtures for the full schedule.';
    show(msg);
    return;
  }

  openGames.forEach(game => {
    const pred = map.get(game.id);

    wrap.insertAdjacentHTML('beforeend', `
      <div class="fixture">
        <div class="fixture-header">
          <div>
            <div class="players">${esc(game.white_player)} vs ${esc(game.black_player)}</div>
            <div class="meta">Round ${game.round_no} • ${esc(game.game_date)} • Poll closes 5:59 PM IST</div>
            <div class="small">${esc(getCountdownText(game))}</div>
          </div>
          <span class="status open">Open now</span>
        </div>
        <div class="choices">
          <button class="choice-btn ${pred?.prediction === 'white_win' ? 'selected' : ''}" data-game="${game.id}" data-value="white_win">${esc(game.white_player)} wins</button>
          <button class="choice-btn ${pred?.prediction === 'draw' ? 'selected' : ''}" data-game="${game.id}" data-value="draw">Draw</button>
          <button class="choice-btn ${pred?.prediction === 'black_win' ? 'selected' : ''}" data-game="${game.id}" data-value="black_win">${esc(game.black_player)} wins</button>
        </div>
        <div class="footer-note">
          ${pred ? `Your pick: <strong>${labelResult(pred.prediction)}</strong>` : '<span class="muted">No prediction submitted yet.</span>'}
        </div>
      </div>
    `);
  });

  wrap.querySelectorAll('.choice-btn').forEach(btn => {
    btn.onclick = async () => {
      const game_id = Number(btn.dataset.game);
      const prediction = btn.dataset.value;

      const { error } = await app.supabase
        .from('predictions')
        .upsert(
          { user_id: app.user.id, game_id, prediction },
          { onConflict: 'user_id,game_id' }
        );

      if (error) return alert(error.message);
      await refresh();
    };
  });
}

function renderFixtures() {
  const wrap = qs('fixtures-list');
  if (!wrap) return;

  wrap.innerHTML = '';

  const games = app.games
    .filter(g => g.tournament === currentFixturesTournament)
    .sort((a, b) => a.round_no - b.round_no || a.id - b.id);

  let currentRound = null;

  games.forEach(game => {
    if (currentRound !== game.round_no) {
      currentRound = game.round_no;
      wrap.insertAdjacentHTML('beforeend', `
        <div class="card" style="grid-column:1/-1; margin-bottom:4px;">
          <div class="section-title"><h2 style="margin:0;">Round ${currentRound}</h2></div>
        </div>
      `);
    }

    const status = getGameStatus(game);

    wrap.insertAdjacentHTML('beforeend', `
      <div class="fixture">
        <div class="fixture-header">
          <div>
            <div class="players">${esc(game.white_player)} vs ${esc(game.black_player)}</div>
            <div class="meta">${esc(game.game_date)}</div>
          </div>
          <span class="status ${status}">${labelStatus(status)}</span>
        </div>
        <div class="footer-note">
          ${game.result ? `<div class="small">Result: <strong>${labelResult(game.result)}</strong></div>` : '<span class="muted">Result not updated yet.</span>'}
        </div>
      </div>
    `);
  });
}

function renderLeaderboard() {
  const tbody = qs('leaderboard-body');
  if (!tbody) return;

  const leaderboard = buildLeaderboard(app.allProfiles, app.allPredictions, app.games, currentLeaderboardTournament);

  tbody.innerHTML = '';
  leaderboard.forEach((row, idx) => {
    tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(row.name)}</td>
        <td>${row.correct}</td>
        <td>${row.attempted}</td>
        <td>${row.accuracy.toFixed(2)}%</td>
      </tr>
    `);
  });
}

function renderStandings() {
  const tbody = qs('standings-body');
  if (!tbody) return;

  const standings = buildStandings(app.games, currentStandingsTournament);
  tbody.innerHTML = '';

  standings.forEach((row, idx) => {
    tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(row.player)}</td>
        <td>${row.played}</td>
        <td>${row.wins}</td>
        <td>${row.draws}</td>
        <td>${row.losses}</td>
        <td>${row.points}</td>
      </tr>
    `);
  });
}

function populateRoundSelect() {
  const select = qs('round-select');
  if (!select) return;

  const rounds = getRoundsForTournament(currentRoundPredictionsTournament);
  const currentValue = select.value;

  select.innerHTML = rounds.map(r => `<option value="${r}">Round ${r}</option>`).join('');

  if (rounds.includes(Number(currentValue))) {
    select.value = currentValue;
  } else if (rounds.length) {
    select.value = String(rounds[0]);
  }
}

function renderRoundPredictions() {
  const messageEl = qs('round-predictions-message');
  const headEl = qs('round-predictions-head');
  const bodyEl = qs('round-predictions-body');
  const select = qs('round-select');

  if (!messageEl || !headEl || !bodyEl || !select) return;

  populateRoundSelect();

  const selectedRound = Number(select.value);
  const roundGames = app.games
    .filter(g => g.tournament === currentRoundPredictionsTournament && g.round_no === selectedRound)
    .sort((a, b) => a.id - b.id);

  headEl.innerHTML = '';
  bodyEl.innerHTML = '';
  messageEl.textContent = '';
  hide(messageEl);

  if (!roundGames.length) {
    messageEl.textContent = 'No games found for this tournament/round.';
    show(messageEl);
    return;
  }

  const roundCompleted = roundGames.every(g => !!g.result);

  if (!roundCompleted) {
    messageEl.textContent = 'This round is not complete yet. Predictions will be visible after all results for the round are updated.';
    show(messageEl);
    return;
  }

  const headerCells = roundGames.map((game, idx) =>
    `<th>G${idx + 1}<br><span class="small">${esc(game.white_player)} vs ${esc(game.black_player)}</span></th>`
  ).join('');

  headEl.innerHTML = `
    <tr>
      <th>User</th>
      ${headerCells}
      <th>Round score</th>
    </tr>
  `;

  app.allProfiles
    .slice()
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
    .forEach(profile => {
      let roundCorrect = 0;

      const cells = roundGames.map(game => {
        const pred = app.allPredictions.find(p => p.user_id === profile.id && p.game_id === game.id);

        if (!pred) {
          return `<td><span class="muted">No pick</span><br><span class="small">Actual: ${esc(shortResultLabel(game.result, game))}</span></td>`;
        }

        const correct = pred.prediction === game.result;
        if (correct) roundCorrect += 1;

        return `
          <td>
            <div>${esc(labelResult(pred.prediction))} ${correct ? '✅' : '❌'}</div>
            <div class="small">Actual: ${esc(shortResultLabel(game.result, game))}</div>
          </td>
        `;
      }).join('');

      maybeShowPerfectRoundEgg(roundGames, roundCorrect, profile);

      bodyEl.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${esc(profile.display_name)}</td>
          ${cells}
          <td>${roundCorrect}/${roundGames.length}</td>
        </tr>
      `);
    });
}

function renderAdmin() {
  const visible = !!app.profile.is_admin;
  qs('admin-tab-btn')?.classList.toggle('hidden', !visible);

  if (!visible) return;

  const tbody = qs('admin-games-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  app.games.forEach(game => {
    tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${game.round_no}</td>
        <td>${esc(game.game_date)}</td>
        <td>${esc(game.white_player)} vs ${esc(game.black_player)} ${game.tournament ? `(${esc(game.tournament)})` : ''}</td>
        <td>
          <select data-id="${game.id}">
            <option value="" ${!game.result ? 'selected' : ''}>No result yet</option>
            <option value="white_win" ${game.result === 'white_win' ? 'selected' : ''}>${esc(game.white_player)} wins</option>
            <option value="draw" ${game.result === 'draw' ? 'selected' : ''}>Draw</option>
            <option value="black_win" ${game.result === 'black_win' ? 'selected' : ''}>${esc(game.black_player)} wins</option>
          </select>
        </td>
      </tr>
    `);
  });

  tbody.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = Number(sel.dataset.id);
      const result = sel.value || null;

      const { error } = await app.supabase
        .from('games')
        .update({ result })
        .eq('id', id);

      if (error) return alert(error.message);
      await refresh();
    });
  });
}

async function refresh() {
  await loadData();
  renderTop();
  renderPolls();
  renderFixtures();
  renderLeaderboard();
  renderStandings();
  renderRoundPredictions();
  renderAdmin();
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab);
  });
}

async function boot() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('PASTE_')) {
    return alert('Open config.js and paste your Supabase URL and key first.');
  }

  if (!app.supabase) {
    app.supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  const { data: { session } } = await app.supabase.auth.getSession();
  app.user = session?.user || null;

  if (!app.user) {
    show(qs('auth-screen'));
    hide(qs('app-screen'));
    return;
  }

  hide(qs('auth-screen'));
  show(qs('app-screen'));

  await ensureProfile(session);
  await refresh();
}

document.addEventListener('DOMContentLoaded', async () => {
  qs('signup-btn') && (qs('signup-btn').onclick = signUp);
  qs('login-btn') && (qs('login-btn').onclick = signIn);
  qs('logout-btn') && (qs('logout-btn').onclick = signOut);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  qs('polls-open-btn')?.addEventListener('click', () => {
    currentPollsTournament = 'open';
    renderPolls();
  });

  qs('polls-women-btn')?.addEventListener('click', () => {
    currentPollsTournament = 'women';
    renderPolls();
  });

  qs('fixtures-open-btn')?.addEventListener('click', () => {
    currentFixturesTournament = 'open';
    renderFixtures();
  });

  qs('fixtures-women-btn')?.addEventListener('click', () => {
    currentFixturesTournament = 'women';
    renderFixtures();
  });

  qs('leaderboard-open-btn')?.addEventListener('click', () => {
    currentLeaderboardTournament = 'open';
    renderLeaderboard();
  });

  qs('leaderboard-women-btn')?.addEventListener('click', () => {
    currentLeaderboardTournament = 'women';
    renderLeaderboard();
  });

  qs('standings-open-btn')?.addEventListener('click', () => {
    currentStandingsTournament = 'open';
    renderStandings();
  });

  qs('standings-women-btn')?.addEventListener('click', () => {
    currentStandingsTournament = 'women';
    renderStandings();
  });

  qs('round-open-btn')?.addEventListener('click', () => {
    currentRoundPredictionsTournament = 'open';
    renderRoundPredictions();
  });

  qs('round-women-btn')?.addEventListener('click', () => {
    currentRoundPredictionsTournament = 'women';
    renderRoundPredictions();
  });

  qs('round-select')?.addEventListener('change', () => {
    renderRoundPredictions();
  });

  let titleClicks = 0;
  let titleResetTimer = null;
  qs('app-title')?.addEventListener('click', () => {
    titleClicks += 1;

    if (titleClicks === 5) {
      showToast('♟ Hidden line discovered. Engine approves.');
      titleClicks = 0;
      if (titleResetTimer) clearTimeout(titleResetTimer);
      titleResetTimer = null;
      return;
    }

    if (titleResetTimer) clearTimeout(titleResetTimer);
    titleResetTimer = setTimeout(() => {
      titleClicks = 0;
      titleResetTimer = null;
    }, 2000);
  });

  activateTab('polls');
  await boot();

  setInterval(() => {
    if (app.user) {
      renderPolls();
    }
  }, 60000);
});