const { createClient } = supabase;
const cfg = window.APP_CONFIG || {};
const app = { supabase:null, user:null, profile:null, games:[], predictions:[], leaderboard:[] };

const qs = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

function esc(v=''){ return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function getISTNow(){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false
  }).formatToParts(new Date()).reduce((a,p) => { a[p.type] = p.value; return a; }, {});
  return { date:`${parts.year}-${parts.month}-${parts.day}`, hour:Number(parts.hour), minute:Number(parts.minute) };
}
function getGameStatus(game){
  const now = getISTNow();
  if (now.date < game.game_date) return 'upcoming';
  if (now.date > game.game_date) return game.result ? 'completed' : 'locked';
  const mins = now.hour * 60 + now.minute;
  return mins < 18 * 60 ? 'open' : (game.result ? 'completed' : 'locked');
}
function labelStatus(s){ return ({upcoming:'Upcoming', open:'Open now', locked:'Locked', completed:'Completed'})[s] || s; }
function labelResult(r){ return ({white_win:'White win', draw:'Draw', black_win:'Black win'})[r] || '—'; }
function predictionMap(){ const m = new Map(); app.predictions.forEach(p => m.set(p.game_id, p)); return m; }

async function ensureProfile(session){
  const user = session?.user;
  if (!user) return null;
  const { data: existing } = await app.supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (existing) return existing;
  const displayName = (user.user_metadata?.display_name || '').trim();
  if (!displayName) throw new Error('Display name is missing.');
  const { data, error } = await app.supabase.from('profiles').insert({
    id: user.id,
    email: user.email,
    display_name: displayName
  }).select().single();
  if (error) throw error;
  return data;
}

function authMessage(msg, type='ok'){
  const el = qs('auth-message');
  el.className = 'notice' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  show(el);
}

async function signUp(){
  const email = qs('signup-email').value.trim();
  const password = qs('signup-password').value.trim();
  const displayName = qs('signup-display-name').value.trim();
  if (!email || !password || !displayName) return authMessage('Please fill all sign-up fields.', 'error');
  const { data, error } = await app.supabase.auth.signUp({
    email, password,
    options:{ data:{ display_name: displayName } }
  });
  if (error) return authMessage(error.message, 'error');
  if (!data.session) return authMessage('Sign-up worked, but your project is still asking for email confirmation. Turn Confirm Email OFF in Supabase for instant sign-up.');
  await ensureProfile(data.session);
  await boot();
}

async function signIn(){
  const email = qs('login-email').value.trim();
  const password = qs('login-password').value.trim();
  if (!email || !password) return authMessage('Please enter email and password.', 'error');
  const { data, error } = await app.supabase.auth.signInWithPassword({ email, password });
  if (error) return authMessage(error.message, 'error');
  await ensureProfile(data.session);
  await boot();
}

async function signOut(){ await app.supabase.auth.signOut(); location.reload(); }

async function loadData(){
  const [{ data: profile, error: pe }, { data: games, error: ge }, { data: predictions, error: pre }, { data: profiles, error: prfe }, { data: allPreds, error: ape }] = await Promise.all([
    app.supabase.from('profiles').select('*').eq('id', app.user.id).single(),
    app.supabase.from('games').select('*').order('game_date').order('id'),
    app.supabase.from('predictions').select('*').eq('user_id', app.user.id),
    app.supabase.from('profiles').select('id, display_name'),
    app.supabase.from('predictions').select('user_id, game_id, prediction')
  ]);
  if (pe) throw pe; if (ge) throw ge; if (pre) throw pre; if (prfe) throw prfe; if (ape) throw ape;
  app.profile = profile; app.games = games || []; app.predictions = predictions || [];
  app.leaderboard = buildLeaderboard(profiles || [], allPreds || [], app.games);
}

function buildLeaderboard(profiles, allPreds, games){
  const gMap = new Map(games.map(g => [g.id, g]));
  return profiles.map(p => {
    let attempted = 0, correct = 0;
    allPreds.filter(x => x.user_id === p.id).forEach(pred => {
      const game = gMap.get(pred.game_id);
      if (game && game.result) { attempted += 1; if (game.result === pred.prediction) correct += 1; }
    });
    const accuracy = attempted ? (correct / attempted) * 100 : 0;
    return { name:p.display_name, attempted, correct, accuracy };
  }).sort((a,b) => b.accuracy - a.accuracy || b.correct - a.correct || a.name.localeCompare(b.name));
}

function renderTop(){
  qs('app-title').textContent = cfg.APP_TITLE || 'Candidates 2026 Prediction League';
  qs('user-pill').textContent = app.profile.display_name;
  const isAdmin = !!app.profile.is_admin;
  qs('admin-pill').classList.toggle('hidden', !isAdmin);
  qs('admin-tab-btn').classList.toggle('hidden', !isAdmin);

  let total = app.predictions.length, finished = 0, correct = 0;
  app.predictions.forEach(pred => {
    const game = app.games.find(g => g.id === pred.game_id);
    if (game && game.result) { finished += 1; if (game.result === pred.prediction) correct += 1; }
  });
  const acc = finished ? ((correct / finished) * 100).toFixed(2) : '0.00';
  qs('kpi-total').textContent = total;
  qs('kpi-finished').textContent = finished;
  qs('kpi-correct').textContent = correct;
  qs('kpi-accuracy').textContent = acc + '%';
}

function renderFixtures(){
  const wrap = qs('fixtures-list'); wrap.innerHTML = '';
  const map = predictionMap();
  app.games.forEach(game => {
    const status = getGameStatus(game);
    const pred = map.get(game.id);
    const editable = status === 'open';
    wrap.insertAdjacentHTML('beforeend', `
      <div class="fixture">
        <div class="fixture-header">
          <div>
            <div class="players">${esc(game.white_player)} vs ${esc(game.black_player)}</div>
            <div class="meta">Round ${game.round_no} • ${esc(game.game_date)} • Poll closes 5:59 PM IST</div>
          </div>
          <span class="status ${status}">${labelStatus(status)}</span>
        </div>
        <div class="choices">
          <button class="choice-btn ${pred?.prediction === 'white_win' ? 'selected' : ''}" data-game="${game.id}" data-value="white_win" ${editable ? '' : 'disabled'}>${esc(game.white_player)} wins</button>
          <button class="choice-btn ${pred?.prediction === 'draw' ? 'selected' : ''}" data-game="${game.id}" data-value="draw" ${editable ? '' : 'disabled'}>Draw</button>
          <button class="choice-btn ${pred?.prediction === 'black_win' ? 'selected' : ''}" data-game="${game.id}" data-value="black_win" ${editable ? '' : 'disabled'}>${esc(game.black_player)} wins</button>
        </div>
        <div class="footer-note">
          ${pred ? `Your pick: <strong>${labelResult(pred.prediction)}</strong>` : '<span class="muted">No prediction submitted yet.</span>'}
          ${game.result ? `<div class="small">Result: <strong>${labelResult(game.result)}</strong></div>` : ''}
        </div>
      </div>
    `);
  });
  wrap.querySelectorAll('.choice-btn').forEach(btn => btn.addEventListener('click', async () => {
    const game_id = Number(btn.dataset.game), prediction = btn.dataset.value;
    const existing = app.predictions.find(x => x.game_id === game_id);
    let resp;
    if (existing) resp = await app.supabase.from('predictions').update({ prediction }).eq('id', existing.id);
    else resp = await app.supabase.from('predictions').insert({ user_id: app.user.id, game_id, prediction });
    if (resp.error) return alert(resp.error.message);
    await refresh();
  }));
}

function renderLeaderboard(){
  const tbody = qs('leaderboard-body'); tbody.innerHTML = '';
  app.leaderboard.forEach((row, idx) => tbody.insertAdjacentHTML('beforeend', `
    <tr>
      <td>${idx + 1}</td>
      <td>${esc(row.name)}</td>
      <td>${row.correct}</td>
      <td>${row.attempted}</td>
      <td>${row.accuracy.toFixed(2)}%</td>
    </tr>
  `));
}

function renderAdmin(){
  const visible = !!app.profile.is_admin;
  if (!visible) return;
  const tbody = qs('admin-games-body'); tbody.innerHTML = '';
  app.games.forEach(game => tbody.insertAdjacentHTML('beforeend', `
    <tr>
      <td>${game.round_no}</td>
      <td>${esc(game.game_date)}</td>
      <td>${esc(game.white_player)} vs ${esc(game.black_player)}</td>
      <td>
        <select data-id="${game.id}">
          <option value="" ${!game.result ? 'selected' : ''}>No result yet</option>
          <option value="white_win" ${game.result === 'white_win' ? 'selected' : ''}>${esc(game.white_player)} wins</option>
          <option value="draw" ${game.result === 'draw' ? 'selected' : ''}>Draw</option>
          <option value="black_win" ${game.result === 'black_win' ? 'selected' : ''}>${esc(game.black_player)} wins</option>
        </select>
      </td>
    </tr>
  `));
  tbody.querySelectorAll('select').forEach(sel => sel.addEventListener('change', async () => {
    const id = Number(sel.dataset.id), result = sel.value || null;
    const { error } = await app.supabase.from('games').update({ result }).eq('id', id);
    if (error) return alert(error.message);
    await refresh();
  }));
}

async function refresh(){ await loadData(); renderTop(); renderFixtures(); renderLeaderboard(); renderAdmin(); }

function activateTab(tab){
  if (tab === 'admin' && (!app.profile || !app.profile.is_admin)) tab = 'fixtures';
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab));
}

async function boot(){
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('PASTE_')) {
    return alert('Open config.js and paste your Supabase URL and key first.');
  }
  if (!app.supabase) app.supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data:{ session } } = await app.supabase.auth.getSession();
  app.user = session?.user || null;
  if (!app.user) { show(qs('auth-screen')); hide(qs('app-screen')); return; }
  hide(qs('auth-screen')); show(qs('app-screen'));
  await ensureProfile(session);
  await refresh();
}

document.addEventListener('DOMContentLoaded', async () => {
  qs('signup-btn').addEventListener('click', signUp);
  qs('login-btn').addEventListener('click', signIn);
  qs('logout-btn').addEventListener('click', signOut);
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
  activateTab('fixtures');
  await boot();
});
