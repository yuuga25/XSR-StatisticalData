(() => {
  'use strict';

  const DATA_URL = 'data.enc';
  const MAGIC = 'XSD1';
  const AAD_TEXT = 'Xross Stats Dashboard v1';
  const PBKDF2_ITERATIONS = 350000;
  const SESSION_KEY = 'xrossStatsSessionPassword';
  const LOG_PAGE_SIZE = 12;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    authScreen: $('#authScreen'), authForm: $('#authForm'), passwordInput: $('#passwordInput'),
    rememberSession: $('#rememberSession'), unlockButton: $('#unlockButton'), togglePassword: $('#togglePassword'),
    authMessage: $('#authMessage'), app: $('#app'), loadingScreen: $('#loadingScreen'), sidebar: $('#sidebar'),
    menuButton: $('#menuButton'), closeMenuButton: $('#closeMenuButton'), sidebarScrim: $('#sidebarScrim'),
    lockButton: $('#lockButton'), modal: $('#modal'), modalContent: $('#modalContent'), toast: $('#toast'),
    mainContent: $('#mainContent'), routeTransition: $('#routeTransition'), routeTransitionIndex: $('#routeTransitionIndex'),
    routeTransitionTitle: $('#routeTransitionTitle'), routeTransitionLabel: $('#routeTransitionLabel')
  };

  const state = {
    encryptedBuffer: null, data: null, prepared: null, activeView: 'overview',
    deckMode: 'all', deckLimit: 30, deckCompare: new Map(), cardType: 'leader',
    selectedTacticDeck: '', logPage: 1, toastTimer: null,
    matchupMode: 'matchup', matchupDeck: '', synergyLimit: 24,
    isTransitioning: false, pendingView: null
  };
  const imageResolutionCache = new Map();
  const ROUTES = [
    { key: 'overview', index: '01', title: 'OVERVIEW', label: '概要' },
    { key: 'decks', index: '02', title: 'DECK ANALYSIS', label: 'デッキ' },
    { key: 'cards', index: '03', title: 'CARD PERFORMANCE', label: 'カード統計' },
    { key: 'tactics', index: '04', title: 'TACTICS ORDER', label: '戦術構成' },
    { key: 'matchup', index: '05', title: 'MATCHUP & SYNERGY', label: '対面・相性' },
    { key: 'logs', index: '06', title: 'MATCH RECORDS', label: '対戦ログ' }
  ];
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    await fetchEncryptedData();
    elements.loadingScreen?.remove();
    document.body.classList.remove('is-loading');
    const savedPassword = sessionStorage.getItem(SESSION_KEY);
    if (savedPassword && state.encryptedBuffer) {
      elements.passwordInput.value = savedPassword;
      await attemptUnlock(savedPassword, true);
    } else {
      elements.passwordInput.focus();
    }
  }

  function bindEvents() {
    elements.authForm.addEventListener('submit', event => {
      event.preventDefault();
      const password = elements.passwordInput.value;
      if (!password) return setAuthMessage('パスワードを入力して。');
      attemptUnlock(password, false);
    });
    elements.togglePassword.addEventListener('click', () => {
      const reveal = elements.passwordInput.type === 'password';
      elements.passwordInput.type = reveal ? 'text' : 'password';
      elements.togglePassword.textContent = reveal ? '隠す' : '表示';
      elements.togglePassword.setAttribute('aria-label', reveal ? 'パスワードを隠す' : 'パスワードを表示');
    });
    elements.lockButton.addEventListener('click', lockApp);
    elements.menuButton.addEventListener('click', openSidebar);
    elements.closeMenuButton.addEventListener('click', closeSidebar);
    elements.sidebarScrim.addEventListener('click', closeSidebar);

    document.addEventListener('click', event => {
      const nav = event.target.closest('[data-view]');
      if (nav) return switchView(nav.dataset.view);
      const jump = event.target.closest('[data-jump]');
      if (jump) return switchView(jump.dataset.jump);
      const overviewDeck = event.target.closest('[data-overview-deck]');
      if (overviewDeck) return showDeckModal(findDeck(overviewDeck.dataset.overviewDeck));
      if (event.target.closest('[data-close-modal]')) closeModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeSidebar();
        if (elements.modal.open) closeModal();
      }
    });

    $('#deckModeTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-deck-mode]');
      if (!button) return;
      state.deckMode = button.dataset.deckMode;
      state.deckLimit = 30;
      state.deckCompare.clear();
      $$('#deckModeTabs button').forEach(item => item.classList.toggle('is-active', item === button));
      renderDecks();
    });
    ['deckSearch', 'deckMinGames'].forEach(id => $(`#${id}`).addEventListener('input', () => { state.deckLimit = 30; renderDecks(); }));
    $('#deckSort').addEventListener('change', () => { state.deckLimit = 30; renderDecks(); });
    $('#loadMoreDecks').addEventListener('click', () => { state.deckLimit += 30; renderDecks(); });
    $('#clearComparison').addEventListener('click', () => { state.deckCompare.clear(); renderDecks(); });
    $('#openComparison').addEventListener('click', showComparisonModal);
    $('#deckList').addEventListener('click', event => {
      const button = event.target.closest('[data-deck-action]');
      if (!button) return;
      const deck = findDeck(button.dataset.deckId);
      if (!deck) return;
      if (button.dataset.deckAction === 'compare') toggleDeckCompare(deck);
      if (button.dataset.deckAction === 'similar') showSimilarModal(deck);
    });

    $('#cardTypeTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-card-type]');
      if (!button) return;
      state.cardType = button.dataset.cardType;
      $$('#cardTypeTabs button').forEach(item => item.classList.toggle('is-active', item === button));
      renderCards();
    });
    $('#cardSearch').addEventListener('input', renderCards);
    $('#cardSort').addEventListener('change', renderCards);

    let tacticTimer;
    $('#tacticDeckSearch').addEventListener('input', event => {
      clearTimeout(tacticTimer);
      tacticTimer = setTimeout(() => {
        renderTacticDeckChoices(event.target.value);
        const exact = [...state.prepared.tacticGroups.keys()].find(deck => normalizeText(deck) === normalizeText(event.target.value));
        if (exact) selectTacticDeck(exact, true);
      }, 120);
    });
    $('#tacticDeckSearch').addEventListener('change', event => selectTacticDeck(event.target.value, true));
    $('#popularTacticDeck').addEventListener('click', () => selectPopularTacticDeck(true));
    $('#tacticDeckRail').addEventListener('click', event => {
      const button = event.target.closest('[data-tactic-deck]');
      if (!button) return;
      selectTacticDeck(decodeURIComponent(button.dataset.tacticDeck), true);
    });

    $('#matchupModeTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-matchup-mode]');
      if (!button) return;
      state.matchupMode = button.dataset.matchupMode;
      state.synergyLimit = 24;
      $$('#matchupModeTabs button').forEach(item => item.classList.toggle('is-active', item === button));
      renderMatchup();
    });
    ['matchupSearch', 'matchupMinGames'].forEach(id => $(`#${id}`).addEventListener('input', () => {
      state.synergyLimit = 24;
      renderMatchup();
    }));
    $('#matchupSort').addEventListener('change', renderMatchup);
    $('#matchupDeckRail').addEventListener('click', event => {
      const button = event.target.closest('[data-matchup-deck]');
      if (!button) return;
      state.matchupDeck = decodeURIComponent(button.dataset.matchupDeck);
      renderMatchup();
    });
    $('#synergyMore').addEventListener('click', () => { state.synergyLimit += 24; renderSynergy(); });

    ['logSearch', 'logTurn', 'logResult', 'logLead'].forEach(id => {
      $(`#${id}`).addEventListener(id === 'logSearch' ? 'input' : 'change', () => { state.logPage = 1; renderLogs(); });
    });
    $('#clearLogFilters').addEventListener('click', () => {
      $('#logSearch').value = '';
      $('#logTurn').value = '';
      $('#logResult').value = '';
      $('#logLead').value = '';
      state.logPage = 1;
      renderLogs();
    });
    $('#logFilterToggle').addEventListener('click', () => {
      const filters = $('#logAdvancedFilters');
      const open = filters.classList.toggle('is-open');
      $('#logFilterToggle').setAttribute('aria-expanded', String(open));
    });
  }

  async function fetchEncryptedData() {
    setAuthMessage('暗号化データを読み込んでいる…', true);
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.encryptedBuffer = await response.arrayBuffer();
      setAuthMessage('');
    } catch (error) {
      console.error(error);
      setAuthMessage('統計データを読み込めなかった。');
    }
  }

  async function attemptUnlock(password, automatic) {
    if (!state.encryptedBuffer) return setAuthMessage('統計データがまだ読み込めていない。');
    setUnlockLoading(true);
    setAuthMessage(automatic ? '保存されたセッションを確認中…' : '統計データを復号している…', true);
    try {
      const data = await decryptPayload(state.encryptedBuffer, password);
      validatePayload(data);
      if (elements.rememberSession.checked) sessionStorage.setItem(SESSION_KEY, password);
      else sessionStorage.removeItem(SESSION_KEY);
      loadData(data);
      elements.authScreen.hidden = true;
      elements.app.hidden = false;
      document.body.classList.add('is-unlocked');
      setAuthMessage('');
    } catch (error) {
      console.error(error);
      sessionStorage.removeItem(SESSION_KEY);
      setAuthMessage('パスワードが違うか、統計データが壊れている。');
      if (!automatic) elements.passwordInput.select();
    } finally {
      setUnlockLoading(false);
    }
  }

  async function decryptPayload(buffer, password) {
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength < 49) throw new Error('Encrypted data is too small');
    const magic = new TextDecoder().decode(bytes.slice(0, 4));
    if (magic !== MAGIC) throw new Error('Unknown encrypted format');
    const salt = bytes.slice(4, 20);
    const iv = bytes.slice(20, 32);
    const ciphertext = bytes.slice(32);
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(AAD_TEXT), tagLength: 128 }, key, ciphertext
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function validatePayload(data) {
    if (!data || data.format !== 'xross-stats-data' || !data.sheets) throw new Error('Invalid data payload');
  }

  function loadData(data) {
    state.data = data;
    state.prepared = prepareData(data);
    state.deckMode = 'all';
    state.deckLimit = 30;
    state.deckCompare.clear();
    state.cardType = state.prepared.cardGroups[0]?.key || 'leader';
    state.logPage = 1;
    $('#deckMinGames').value = state.prepared.meta.minGames;
    $('#topPeriod').textContent = state.prepared.meta.period;
    $('#topUpdated').textContent = state.prepared.meta.lastUpdated || '—';
    $('#sidebarGames').textContent = `${formatInt(state.prepared.meta.games)} matches`;
    renderAll();
    const hashView = location.hash.slice(1);
    switchView(ROUTES.some(route => route.key === hashView) ? hashView : 'overview', false);
  }

  function prepareData(data) {
    const summaryRows = getSheetRows(data, 'Summary');
    const summary = new Map(summaryRows.filter(row => row?.[0] != null).map(row => [String(row[0]), row[1]]));
    const decks = {
      all: recordsFromSheet(data, 'D1_DeckWinRate_All', 1).map((record, i) => normalizeDeck(record, 'all', i)),
      win: recordsFromSheet(data, 'D2_DeckWinRate_WinLead', 1).map((record, i) => normalizeDeck(record, 'win', i)),
      lose: recordsFromSheet(data, 'D3_DeckWinRate_LoseLead', 1).map((record, i) => normalizeDeck(record, 'lose', i))
    };
    const cardConfigs = [
      { key: 'leader', label: 'リーダー', role: 'leader', sheet: 'G2_LeaderStats', nameKey: 'リーダー名', countKey: '採用数', rateKey: '採用率', countLabel: '採用数', rateLabel: '採用率' },
      { key: 'ace', label: 'ACE', role: 'ace', sheet: 'G3_AceStats', nameKey: 'ACE名', countKey: '採用数', rateKey: '採用率', countLabel: '採用数', rateLabel: '採用率' },
      { key: 'tactics', label: 'タクティクス', role: 'tactics', sheet: 'G4_TacticStats', nameKey: 'タクティクス名', countKey: '使用数', rateKey: '使用率', countLabel: '使用数', rateLabel: '使用率' }
    ].filter(config => data.sheets?.[config.sheet]);
    const logs = recordsFromSheet(data, 'RawLogs', 1)
      .map((record, index) => sanitizeLogRecord(record, index))
      .sort((a, b) => number(b['大会日付']) - number(a['大会日付']) || number(b['更新日時']) - number(a['更新日時']) || number(b['対戦番号']) - number(a['対戦番号']));
    // 相手側・ラウンド別・対面・相性はシートに存在しないため RawLogs から集計する。
    // 1試合1行なので、相手側の母数は「試合数」。G2・G3の採用率は「ログ数」、
    // G4の使用率は「延べ選択数」が母数で、単純には比べられない点に注意。
    const cardGroups = [
      ...cardConfigs.map(config => ({
        ...config,
        items: recordsFromSheet(data, config.sheet, 1).map((record, i) => normalizeCardStat(record, config, i))
      })),
      ...buildOpponentGroups(logs)
    ];
    const tacticGroups = buildTacticGroups(data, logs);
    return {
      summary, decks, cardGroups,
      firstSecond: recordsFromSheet(data, 'G1_FirstSecond', 1),
      leadStats: recordsFromSheet(data, 'G5_LeadWinRate', 1),
      dailyTrend: buildDailyTrend(logs),
      deckMatchups: buildDeckMatchups(logs),
      synergy: buildSynergy(logs),
      tacticGroups, logs,
      meta: {
        period: String(summary.get('集計対象期間（大会日付）') || '—'),
        games: number(summary.get('対象試合数')), logs: number(summary.get('対象ログ数')),
        users: number(summary.get('ユニークユーザー数')), decks: number(summary.get('ユニークデッキ数（リーダー4+ACE）')),
        minGames: number(summary.get('最低試合数 N（変更可）')) || 0,
        lastUpdated: formatDateTime(summary.get('最終更新'))
      }
    };
  }

  function getSheetRows(data, name) { return data.sheets?.[name]?.rows || []; }
  function recordsFromSheet(data, name, headerIndex = 1) {
    const rows = getSheetRows(data, name);
    const headers = (rows[headerIndex] || []).map((value, i) => value == null || value === '' ? `列${i + 1}` : String(value));
    return rows.slice(headerIndex + 1).filter(row => row?.some(value => value !== null && value !== '')).map((row, rowIndex) => {
      const record = { __row: rowIndex + headerIndex + 2 };
      headers.forEach((header, i) => { record[header] = row[i] ?? null; });
      return record;
    });
  }
  function normalizeDeck(record, mode, index) {
    const leaders = [1,2,3,4].map(i => String(record[`リーダー${i}`] || '')).filter(Boolean);
    const aceText = String(record['ACE'] || '');
    const aces = aceText.split(' / ').map(value => value.trim()).filter(Boolean);
    return {
      uid: `${mode}-${index}`, mode, rank: number(record['順位']) || index + 1, leaders, aces, aceText,
      games: number(record['試合数']), wins: number(record['勝数']), winRate: number(record['勝率']),
      confidence: number(record['信頼下限']), category: String(record['区分'] || ''), raw: record,
      search: normalizeText([...leaders, ...aces].join(' '))
    };
  }
  function normalizeCardStat(record, config, index) {
    const games = number(record['試合数']);
    const wins = number(record['勝数']);
    return {
      key: config.key, role: config.role, rank: index + 1, name: String(record[config.nameKey] || ''),
      count: number(record[config.countKey]), adoptionRate: number(record[config.rateKey]), games, wins,
      winRate: number(record['勝率']),
      // シートに信頼下限の列はないので、試合数と勝数から同じ式で算出する。
      confidence: record['信頼下限'] == null ? wilsonLower(wins, games) : number(record['信頼下限']),
      raw: record
    };
  }

  // Wilson区間の下限（両側95%）。Summaryの「信頼下限」と同じ定義。
  function wilsonLower(wins, games) {
    const n = number(games);
    if (n <= 0) return 0;
    const z = 1.96;
    const p = number(wins) / n;
    return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
  }

  const RAW_LOG_HIDDEN_FIELDS = new Set(['ownerUid', 'ログID', 'ドキュメントID', 'ステータス']);
  function sanitizeLogRecord(record, index) {
    const clean = { __index: index };
    Object.entries(record).forEach(([key, value]) => {
      if (!RAW_LOG_HIDDEN_FIELDS.has(key)) clean[key] = value;
    });
    const searchable = Object.entries(clean)
      .filter(([key, value]) => !key.startsWith('__') && value != null)
      .map(([, value]) => value)
      .join(' ');
    clean.__search = normalizeText(searchable);
    return clean;
  }
  function buildTacticGroups(data, logs) {
    const groups = new Map();
    const add = (deck, item) => {
      if (!deck || !item.order || item.order.includes('#NAME?')) return;
      if (!groups.has(deck)) groups.set(deck, []);
      groups.get(deck).push(item);
    };
    for (const row of recordsFromSheet(data, '_T1_Data', 1)) {
      const deck = String(row['デッキ'] || '').trim();
      const order = String(row['タクティクス並び'] || '').trim();
      add(deck, {
        order,
        uses: number(row['使用数']), useRate: number(row['使用率']),
        games: number(row['試合数']), wins: number(row['勝数']), winRate: number(row['勝率'])
      });
    }
    if (!groups.size) {
      const counters = new Map();
      logs.forEach(log => {
        const leaders = logLeaders(log, '自分');
        const aces = logAces(log, '自分');
        const tactics = logTactics(log, '自分');
        if (leaders.length !== 4 || !tactics.length) return;
        const deck = `${leaders.join(' / ')} ＋ ${aces.join(' / ')}`;
        const order = tactics.join(' → ');
        const key = `${deck}::TACTIC::${order}`;
        const counter = counters.get(key) || { deck, order, uses: 0, games: 0, wins: 0 };
        counter.uses += 1; counter.games += 1; counter.wins += log['結果'] === '勝' ? 1 : 0;
        counters.set(key, counter);
      });
      const totals = new Map();
      counters.forEach(item => totals.set(item.deck, (totals.get(item.deck) || 0) + item.uses));
      counters.forEach(item => add(item.deck, { ...item, useRate: item.uses / Math.max(totals.get(item.deck) || 1, 1), winRate: item.wins / Math.max(item.games, 1) }));
    }
    for (const list of groups.values()) list.sort((a, b) => b.uses - a.uses || b.games - a.games || b.winRate - a.winRate);
    return groups;
  }

  // ---- RawLogs からの集計 ---------------------------------------------------
  // RawLogs は1試合1行。列は自分側/相手側が対になっている。

  // カード名に現れない文字を組み合わせキーの区切りに使う。
  const KEY_SEP = '\u001f';

  function logLeaders(log, side) {
    return [1,2,3,4].map(i => String(log[`${side}リーダー${i}`] || '').trim()).filter(Boolean);
  }
  function logAces(log, side) {
    return Array.from({ length: 8 }, (_, i) => String(log[`${side}ACE${i + 1}`] || '').trim()).filter(Boolean);
  }
  function logTactics(log, side) {
    return [1,2,3].map(i => String(log[`${side}戦術${i}`] || '').trim()).filter(Boolean);
  }
  /** 試合ごとに重複を除いたキーで [試合数, 勝数] を数える。 */
  function tallyLogs(logs, extract) {
    const counter = new Map();
    logs.forEach(log => {
      const win = log['結果'] === '勝' ? 1 : 0;
      new Set(extract(log)).forEach(key => {
        const entry = counter.get(key) || [0, 0];
        entry[0] += 1; entry[1] += win;
        counter.set(key, entry);
      });
    });
    return counter;
  }

  function buildOpponentGroups(logs) {
    if (!logs.length) return [];
    const specs = [
      { key: 'oppLeader', label: '相手リーダー', role: 'leader', countLabel: '遭遇数', rateLabel: '遭遇率',
        extract: log => logLeaders(log, '相手'), perMatch: true },
      { key: 'oppAce', label: '相手ACE', role: 'ace', countLabel: '遭遇数', rateLabel: '遭遇率',
        extract: log => logAces(log, '相手'), perMatch: true },
      { key: 'oppTactics', label: '相手タクティクス', role: 'tactics', countLabel: '使用数', rateLabel: '使用率',
        extract: log => logTactics(log, '相手'), perMatch: false }
    ];
    return specs.map(spec => {
      const counter = tallyLogs(logs, spec.extract);
      // 遭遇率は総試合数が母数。タクティクスだけは延べ選択数を母数にしてG4に揃える。
      const base = spec.perMatch
        ? logs.length
        : [...counter.values()].reduce((total, entry) => total + entry[0], 0);
      const items = [...counter.entries()]
        .map(([name, [games, wins]]) => ({
          key: spec.key, role: spec.role, name, count: games, games, wins,
          adoptionRate: base ? games / base : 0,
          winRate: games ? wins / games : 0,
          confidence: wilsonLower(wins, games)
        }))
        .sort((a, b) => b.count - a.count || b.winRate - a.winRate || a.name.localeCompare(b.name, 'ja'));
      items.forEach((item, i) => { item.rank = i + 1; });
      return { ...spec, opponent: true, items };
    }).filter(group => group.items.length);
  }

  function buildDailyTrend(logs) {
    if (!logs.length) return [];
    const days = new Map();
    logs.forEach(log => {
      const serial = number(log['大会日付']);
      if (!serial) return;
      const day = Math.floor(serial);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(log);
    });
    return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, group]) => {
      const wins = group.filter(log => log['結果'] === '勝').length;
      const first = group.filter(log => log['先後'] === '先攻').length;
      const lead = group.filter(log => log['進行'] === '勝ち進行').length;
      return {
        '大会日付': day, '試合数': group.length, '勝数': wins,
        '勝率': group.length ? wins / group.length : 0,
        '先攻数': first, '先攻率': group.length ? first / group.length : 0,
        '勝ち進行数': lead, '勝ち進行率': group.length ? lead / group.length : 0,
        'ユーザー数': new Set(group.map(log => log['ユーザー名'])).size
      };
    });
  }

  /**
   * デッキ（リーダー4体＋ACE）ごとの対面成績。
   * 相手側もデッキ単位にすると、1,308試合では10試合以上の組み合わせが
   * 1つも成立しない（最大9試合）ため、相手側はリーダー単位で数える。
   */
  function buildDeckMatchups(logs) {
    if (!logs.length) return [];
    const decks = new Map();
    logs.forEach(log => {
      const leaders = logLeaders(log, '自分');
      if (leaders.length !== 4) return;
      const aces = logAces(log, '自分');
      const label = `${leaders.join(' / ')} ＋ ${aces.join(' / ')}`;
      if (!decks.has(label)) {
        decks.set(label, { label, leaders, aces, games: 0, wins: 0, vs: new Map(), search: normalizeText([...leaders, ...aces].join(' ')) });
      }
      const deck = decks.get(label);
      const win = log['結果'] === '勝' ? 1 : 0;
      deck.games += 1;
      deck.wins += win;
      new Set(logLeaders(log, '相手')).forEach(opponent => {
        const row = deck.vs.get(opponent) || { opponent, games: 0, wins: 0 };
        row.games += 1;
        row.wins += win;
        deck.vs.set(opponent, row);
      });
    });
    return [...decks.values()].map(deck => ({
      ...deck,
      winRate: deck.games ? deck.wins / deck.games : 0,
      confidence: wilsonLower(deck.wins, deck.games),
      vs: [...deck.vs.values()].map(row => ({
        ...row,
        winRate: row.games ? row.wins / row.games : 0,
        confidence: wilsonLower(row.wins, row.games)
      }))
    })).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  }

  function buildSynergy(logs) {
    if (!logs.length) return [];
    const counter = tallyLogs(logs, log => {
      const leaders = [...new Set(logLeaders(log, '自分'))].sort((a, b) => a.localeCompare(b, 'ja'));
      const pairs = [];
      for (let i = 0; i < leaders.length; i += 1) {
        for (let j = i + 1; j < leaders.length; j += 1) pairs.push(`${leaders[i]}${KEY_SEP}${leaders[j]}`);
      }
      return pairs;
    });
    const rows = [...counter.entries()].map(([key, [games, wins]]) => {
      const [a, b] = key.split(KEY_SEP);
      return {
        a, b, games, wins,
        pairRate: logs.length ? games / logs.length : 0,
        winRate: games ? wins / games : 0,
        confidence: wilsonLower(wins, games),
        search: normalizeText(`${a} ${b}`)
      };
    }).sort((x, y) => y.confidence - x.confidence || y.games - x.games);
    rows.forEach((row, i) => { row.rank = i + 1; });
    return rows;
  }

  function renderAll() {
    renderOverview();
    renderDecks();
    renderCardTabs();
    renderCards();
    initializeTactics();
    initializeMatchup();
    renderLogs();
  }

  function renderOverview() {
    const { meta, firstSecond, leadStats, decks, cardGroups, summary } = state.prepared;
    const first = firstSecond.find(row => row['先後'] === '先攻') || {};
    const second = firstSecond.find(row => row['先後'] === '後攻') || {};
    const firstRate = number(first['勝率']);
    const delta = firstRate - number(second['勝率']);
    $('#overviewLead').textContent = `${meta.period}  /  ${formatInt(meta.games)} MATCHES  /  ${formatInt(meta.users)} PLAYERS`;
    $('#heroWinRate').textContent = percent(firstRate, 1);
    const kpis = [
      { label: '対象試合', value: meta.games, unit: '試合', sub: `${formatInt(meta.logs)}件の提出ログ`, color: 'var(--cyan)' },
      { label: '参加ユーザー', value: meta.users, unit: '人', sub: '集計期間内', color: 'var(--violet)' },
      { label: 'デッキ構成', value: meta.decks, unit: '種', sub: 'リーダー4体＋ACE', color: 'var(--magenta)' },
      { label: '掲載条件', value: meta.minGames, unit: '試合', sub: '最低試合数', color: 'var(--blue)' }
    ];
    $('#kpiGrid').innerHTML = kpis.map((item, i) => `
      <article class="kpi-card" style="--kpi-color:${item.color}">
        <div class="kpi-card__index"><span>0${i + 1}</span><span>${escapeHtml(item.label)}</span></div>
        <strong class="kpi-card__value" data-counter="${item.value}">0<small>${escapeHtml(item.unit)}</small></strong>
        <span class="kpi-card__sub">${escapeHtml(item.sub)}</span>
      </article>`).join('');
    $('#insightStrip').innerHTML = `
      <div class="insight-cell"><span>先攻 勝率</span><strong>${percent(firstRate, 1)}</strong><small>${formatInt(first['試合数'])}試合</small></div>
      <div class="insight-cell insight-cell--gap"><span>先後差</span><strong>${delta >= 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(1)}<i>pt</i></strong><small>${delta >= 0 ? '先攻有利' : '後攻有利'}</small></div>
      <div class="insight-cell"><span>後攻 勝率</span><strong>${percent(second['勝率'], 1)}</strong><small>${formatInt(second['試合数'])}試合</small></div>`;
    $('#turnOrderChart').innerHTML = firstSecond.map(row => `
      <div class="turn-row">
        <div class="turn-row__label"><strong>${escapeHtml(row['先後'])}</strong><small>${formatInt(row['試合数'])}試合</small></div>
        ${winBarHTML(row['勝率'])}
        <div class="turn-row__rate">${percent(row['勝率'], 1)}</div>
      </div>`).join('')
      + `<div class="turn-delta"><span>先後差</span><strong>${delta >= 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(1)} pt</strong></div>`
      + `<p class="chart-note">バーは勝率50%を中心に、右へ伸びるほど有利。</p>`;
    const leadTotal = leadStats.filter(row => row['先後'] === '合計');
    $('#leadFlowChart').innerHTML = leadTotal.map(row => `
      <div class="flow-card">
        <div class="flow-card__head"><h4>${escapeHtml(row['進行'])}</h4><strong>${percent(row['勝率'], 1)}</strong></div>
        <div class="flow-card__meta"><span>${formatInt(row['勝数'])}勝 / ${formatInt(row['試合数'])}試合</span><span>構成比 ${percent(row['構成比'], 1)}</span></div>
        ${winBarHTML(row['勝率'])}
      </div>`).join('');
    $('#overviewDecks').innerHTML = decks.all.slice(0, 6).map(deck => `
      <button class="top-deck" type="button" data-overview-deck="${deck.uid}">
        <span class="top-deck__rank">#${deck.rank}</span>
        <span class="top-deck__copy"><strong>${escapeHtml(deck.leaders.join(' / '))}</strong><small>${escapeHtml(deck.aceText)}</small></span>
        <span class="top-deck__metrics"><span><span>勝率</span><strong>${percent(deck.winRate, 1)}</strong></span><span><span>試合</span><strong>${formatInt(deck.games)}</strong></span></span>
      </button>`).join('');
    const getGroup = key => cardGroups.find(group => group.key === key)?.items || [];
    $('#leaderSpotlight').innerHTML = spotlightHTML(getGroup('leader'), 'leader', false);
    $('#aceSpotlight').innerHTML = spotlightHTML(getGroup('ace'), 'ace', false);
    $('#tacticsSpotlight').innerHTML = spotlightHTML(getGroup('tactics'), 'tactics', true);
    renderDailyTrend();
    const noteKeys = ['記載方針', '進行の定義', '信頼下限'];
    $('#summaryNotes').innerHTML = noteKeys.filter(key => summary.has(key)).map(key => `<div class="note"><b>${escapeHtml(key)}</b><p>${escapeHtml(summary.get(key))}</p></div>`).join('');
    hydrateCardImages($('[data-view-panel="overview"]'));
    animateVisuals($('[data-view-panel="overview"]'));
  }

  function renderDailyTrend() {
    const rows = state.prepared.dailyTrend || [];
    const container = $('#dailyTrendChart');
    if (!container) return;
    if (!rows.length) return void (container.innerHTML = '<div class="empty-state">日別データがない。</div>');

    // 試合数を棒、勝率を折れ線で重ねた軽量なSVG。外部ライブラリは使わない。
    // SVGは横方向に引き伸ばして描くため、文字は歪まないHTML側へ出す。
    const W = 1000, H = 300, PAD_X = 12, PAD_T = 14, PAD_B = 10;
    const innerW = W - PAD_X * 2;
    const innerH = H - PAD_T - PAD_B;
    const maxGames = Math.max(...rows.map(row => number(row['試合数'])), 1);
    const step = innerW / rows.length;
    const barW = step * .56;
    const x = i => PAD_X + step * (i + .5);
    const yRate = value => PAD_T + innerH * (1 - Math.min(Math.max(value, 0), 1));

    const tip = row => `${formatExcelDate(row['大会日付'])} ／ ${formatInt(row['試合数'])}試合 ／ 勝率 ${percent(row['勝率'], 1)}`;
    const bars = rows.map((row, i) => {
      const height = innerH * (number(row['試合数']) / maxGames);
      return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${(PAD_T + innerH - height).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(height, 2).toFixed(1)}" class="trend-bar"><title>${escapeHtml(tip(row))}</title></rect>`;
    }).join('');
    const points = rows.map((row, i) => `${x(i).toFixed(1)},${yRate(number(row['勝率'])).toFixed(1)}`).join(' ');

    const labels = rows.map((row, i) => {
      if (rows.length > 10 && i % 3 !== 0 && i !== rows.length - 1) return '';
      const short = formatExcelDate(row['大会日付']).replace(/^\d{4}\//, '');
      return `<span style="left:${(x(i) / W * 100).toFixed(2)}%">${escapeHtml(short)}</span>`;
    }).join('');

    const totalGames = sum(rows.map(row => row['試合数']));
    const totalWins = sum(rows.map(row => row['勝数']));
    container.innerHTML = `<div class="trend-plot">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="日別の試合数と勝率" preserveAspectRatio="none">
          <line x1="${PAD_X}" x2="${W - PAD_X}" y1="${yRate(.5).toFixed(1)}" y2="${yRate(.5).toFixed(1)}" class="trend-baseline"/>
          ${bars}<polyline points="${points}" class="trend-line"/>
        </svg>
        <b class="trend-mark" style="top:${(yRate(.5) / H * 100).toFixed(2)}%">50%</b>
      </div>
      <div class="trend-axis">${labels}</div>
      <div class="trend-legend">
        <span class="trend-legend__bar">試合数</span><span class="trend-legend__line">勝率</span>
        <span class="trend-legend__total">${formatInt(rows.length)}日 / ${formatInt(totalGames)}試合 / 通算 ${percent(totalGames ? totalWins / totalGames : 0, 1)}</span>
      </div>`;
  }

  /**
   * 勝率バー。50%を中心に、右へ伸びれば有利・左へ伸びれば不利。
   * 0起点のバーだと 61.9% と 51.9% の差が見た目でほとんど出ないため、
   * 勝率を扱うバーはすべてこれに統一する（採用率などの構成比は0起点のまま）。
   */
  function winBarHTML(rate) {
    const value = Math.min(Math.max(number(rate), 0), 1);
    const tone = value >= .55 ? 'is-good' : value <= .45 ? 'is-bad' : 'is-even';
    return `<div class="mu-bar ${tone}">
      <i data-bar="${Math.max(Math.abs(value - .5) * 100, .8)}%" style="left:${(Math.min(value, .5) * 100).toFixed(2)}%"></i>
    </div>`;
  }

  function spotlightHTML(items, role, isUsage) {
    if (!items.length) return '<div class="empty-state">データがない。</div>';
    const [top, ...others] = items.slice(0, 4);
    return `<div class="spotlight">
      <div class="spotlight__art">${cardArtHTML(top.name, role, 'lg')}</div>
      <div class="spotlight__copy"><h4>${escapeHtml(top.name)}</h4><p>${isUsage ? '使用率' : '採用率'}トップ</p>
        <div class="spotlight__metric"><span>${isUsage ? '使用率' : '採用率'}</span><strong>${percent(top.adoptionRate, 1)}</strong></div>
        <div class="spotlight__metric"><span>勝率</span><strong>${percent(top.winRate, 1)}</strong></div>
      </div>
    </div><div class="spotlight__others">${others.map((item, i) => `<div class="spotlight__other"><b>#${i + 2} ${escapeHtml(item.name)}</b><span>${percent(item.adoptionRate, 1)}</span></div>`).join('')}</div>`;
  }

  function getFilteredDecks() {
    const query = normalizeText($('#deckSearch').value);
    const minGames = Math.max(0, number($('#deckMinGames').value));
    const sort = $('#deckSort').value;
    const sorters = {
      confidence: (a,b) => b.confidence - a.confidence || b.games - a.games,
      winrate: (a,b) => b.winRate - a.winRate || b.games - a.games,
      games: (a,b) => b.games - a.games || b.winRate - a.winRate,
      wins: (a,b) => b.wins - a.wins || b.games - a.games
    };
    return [...state.prepared.decks[state.deckMode]].filter(deck => deck.games >= minGames && (!query || deck.search.includes(query))).sort(sorters[sort] || sorters.confidence);
  }

  function renderDecks() {
    if (!state.prepared) return;
    const filtered = getFilteredDecks();
    const visible = filtered.slice(0, state.deckLimit);
    $('#deckCountBadge strong').textContent = formatInt(filtered.length);
    $('#loadMoreDecks').hidden = visible.length >= filtered.length;
    $('#deckList').innerHTML = visible.length ? visible.map(deck => {
      const selected = state.deckCompare.has(deck.uid);
      return `<article class="deck-card ${selected ? 'is-selected' : ''}">
        <div class="deck-rank">#${deck.rank}</div>
        <div class="deck-lineup">
          <div class="deck-lineup__leaders" data-card-count="${deck.leaders.length}">${deck.leaders.map(name => lineupCardHTML(name, 'leader')).join('')}</div>
          <div class="deck-lineup__aces"><span class="deck-lineup__label">ACE</span>${deck.aces.map(name => cardChipHTML(name, 'ace', true)).join('')}</div>
        </div>
        <div class="deck-metrics">
          <div class="deck-headline">
            <span>勝率</span>
            <strong>${percent(deck.winRate, 1)}</strong>
            ${winBarHTML(deck.winRate)}
          </div>
          <div class="deck-subs">
            <div><span>試合</span><b>${formatInt(deck.games)}</b></div>
            <div><span>勝数</span><b>${formatInt(deck.wins)}</b></div>
            <div><span>信頼下限</span><b>${percent(deck.confidence, 1)}</b></div>
          </div>
        </div>
        <div class="deck-actions">
          <button class="${selected ? 'is-active' : ''}" type="button" data-deck-action="compare" data-deck-id="${deck.uid}">${selected ? '比較から外す' : '比較に追加'}</button>
          <button type="button" data-deck-action="similar" data-deck-id="${deck.uid}">似た構成を見る</button>
        </div>
      </article>`;
    }).join('') : '<div class="empty-state"><strong>該当するデッキがない</strong>検索条件か最低試合数を調整して。</div>';
    renderCompareTray();
    hydrateCardImages($('#deckList'));
    animateVisuals($('[data-view-panel="decks"]'));
  }

  function toggleDeckCompare(deck) {
    if (state.deckCompare.has(deck.uid)) state.deckCompare.delete(deck.uid);
    else {
      if (state.deckCompare.size >= 4) return showToast('比較できるのは最大4デッキまで。');
      state.deckCompare.set(deck.uid, deck);
    }
    renderDecks();
  }
  function renderCompareTray() {
    const count = state.deckCompare.size;
    $('#compareTray').hidden = count === 0;
    $('#compareCount').textContent = count;
    $('#compareNames').innerHTML = [...state.deckCompare.values()].map(deck => `<span class="compare-name">${escapeHtml(deck.leaders.join(' / '))}</span>`).join('');
    $('#openComparison').disabled = count < 2;
  }
  function findDeck(uid) {
    for (const list of Object.values(state.prepared?.decks || {})) {
      const found = list.find(deck => deck.uid === uid);
      if (found) return found;
    }
    return null;
  }
  function getSimilarDecks(target) {
    return state.prepared.decks.all.filter(deck => deck.uid !== target.uid).map(deck => {
      const leaderMatch = intersectionSize(target.leaders, deck.leaders) / Math.max(target.leaders.length, deck.leaders.length, 1);
      const aceMatch = intersectionSize(target.aces, deck.aces) / Math.max(target.aces.length, deck.aces.length, 1);
      return { deck, score: leaderMatch * .72 + aceMatch * .28 };
    }).filter(item => item.score > 0).sort((a,b) => b.score - a.score || b.deck.games - a.deck.games);
  }
  function similarListHTML(items) {
    if (!items.length) return '<div class="empty-state">近い構成は見つからなかった。</div>';
    return `<div class="similar-list">${items.map(({deck, score}) => `<div class="similar-row">
      <div class="similar-row__score">${Math.round(score * 100)}%</div>
      <div class="similar-row__deck"><strong>${escapeHtml(deck.leaders.join(' / '))}</strong><small>${escapeHtml(deck.aceText)}</small></div>
      <div class="similar-row__rate">勝率 ${percent(deck.winRate, 1)}<br>${formatInt(deck.games)}試合</div>
    </div>`).join('')}</div>`;
  }
  function showDeckModal(deck) {
    if (!deck) return;
    openModal(`<p class="kicker">DECK DETAIL</p><h2 class="modal-title">#${deck.rank} デッキ詳細</h2>
      <div class="modal-lineup">${deck.leaders.map(name => cardChipHTML(name, 'leader')).join('')}${deck.aces.map(name => cardChipHTML(name, 'ace', true)).join('')}</div>
      <div class="deck-metrics"><div class="deck-metric"><span>試合数</span><strong>${formatInt(deck.games)}</strong></div><div class="deck-metric"><span>勝数</span><strong>${formatInt(deck.wins)}</strong></div><div class="deck-metric deck-metric--accent"><span>勝率</span><strong>${percent(deck.winRate, 1)}</strong></div><div class="deck-metric"><span>信頼下限</span><strong>${percent(deck.confidence, 1)}</strong></div></div>
      <p class="kicker" style="margin-top:28px">SIMILAR DECKS</p>${similarListHTML(getSimilarDecks(deck).slice(0, 7))}`);
  }
  function showSimilarModal(deck) {
    openModal(`<p class="kicker">SIMILAR DECKS</p><h2 class="modal-title">似た構成を比較</h2><p class="modal-subtitle">${escapeHtml(deck.leaders.join(' / '))}<br>${escapeHtml(deck.aceText)}</p>${similarListHTML(getSimilarDecks(deck).slice(0, 14))}`);
  }
  function showComparisonModal() {
    const decks = [...state.deckCompare.values()];
    if (decks.length < 2) return;
    const rows = [
      ['リーダー', deck => deck.leaders.join(' / ')], ['ACE', deck => deck.aceText], ['試合数', deck => formatInt(deck.games)],
      ['勝数', deck => formatInt(deck.wins)], ['勝率', deck => percent(deck.winRate, 1)], ['信頼下限', deck => percent(deck.confidence, 1)]
    ];
    openModal(`<p class="kicker">COMPARISON</p><h2 class="modal-title">デッキ比較</h2><p class="modal-subtitle">選択した${decks.length}デッキを横並びで確認。</p>
      <div class="comparison"><div class="comparison__grid" style="--columns:${decks.length}">
        <div class="comparison__cell comparison__cell--label">項目</div>${decks.map((_,i) => `<div class="comparison__cell comparison__cell--head">DECK ${i + 1}</div>`).join('')}
        ${rows.map(([label,getter]) => `<div class="comparison__cell comparison__cell--label">${label}</div>${decks.map(deck => `<div class="comparison__cell">${escapeHtml(getter(deck))}</div>`).join('')}`).join('')}
      </div></div>`);
  }

  function renderCardTabs() {
    const groups = state.prepared.cardGroups;
    $('#cardTypeTabs').innerHTML = groups.map(group => `<button class="${group.key === state.cardType ? 'is-active' : ''}" type="button" data-card-type="${escapeHtml(group.key)}">${escapeHtml(group.label)}</button>`).join('');
  }
  function renderCards() {
    if (!state.prepared) return;
    const group = state.prepared.cardGroups.find(item => item.key === state.cardType) || state.prepared.cardGroups[0];
    if (!group) return;
    const query = normalizeText($('#cardSearch').value);
    const sort = $('#cardSort').value;
    const sorters = {
      adoption: (a,b) => b.adoptionRate - a.adoptionRate || b.count - a.count,
      confidence: (a,b) => b.confidence - a.confidence || b.games - a.games,
      winrate: (a,b) => b.winRate - a.winRate || b.games - a.games,
      games: (a,b) => b.games - a.games || b.winRate - a.winRate,
      count: (a,b) => b.count - a.count || b.adoptionRate - a.adoptionRate
    };
    const list = [...group.items].filter(item => !query || normalizeText(item.name).includes(query)).sort(sorters[sort] || sorters.adoption);
    const maxRate = Math.max(...list.map(item => item.adoptionRate), .01);
    const rateLabel = group.rateLabel || '採用率';
    const countLabel = group.countLabel || '採用数';
    const winLabel = group.opponent ? '対面勝率' : '勝率';
    $('#cardCountBadge strong').textContent = formatInt(list.length);
    $('#cardStatsList').innerHTML = list.length ? list.map((item, index) => `<article class="card-stat${group.opponent ? ' card-stat--opponent' : ''}">
      <span class="card-stat__rank">${String(index + 1).padStart(2, '0')}</span>
      ${cardArtHTML(item.name, group.role, 'lg')}
      <div class="card-stat__body"><h3>${escapeHtml(item.name)}${group.opponent ? '<em class="card-stat__side">VS</em>' : ''}</h3>
        <div class="card-stat__headline"><div><span>${rateLabel}</span><strong>${percent(item.adoptionRate, 1)}</strong></div><div><span>${winLabel}</span><strong>${percent(item.winRate, 1)}</strong></div></div>
        <div class="card-stat__bar"><div class="rate-bar"><i data-bar="${Math.max(item.adoptionRate / maxRate * 100, 1)}%"></i></div></div>
        <div class="card-stat__minor"><div><span>${countLabel}</span><strong>${formatInt(item.count)}</strong></div><div><span>試合数</span><strong>${formatInt(item.games)}</strong></div><div><span>信頼下限</span><strong>${percent(item.confidence, 1)}</strong></div></div>
      </div>
    </article>`).join('') : '<div class="empty-state"><strong>該当するカードがない</strong>検索語を変えて。</div>';
    hydrateCardImages($('#cardStatsList'));
    animateVisuals($('[data-view-panel="cards"]'));
  }

  function sortedTacticGroups() {
    return [...state.prepared.tacticGroups.entries()].sort((a,b) => sum(b[1].map(item => item.uses)) - sum(a[1].map(item => item.uses)) || a[0].localeCompare(b[0], 'ja'));
  }
  function initializeTactics() {
    const groups = sortedTacticGroups();
    $('#tacticDeckCount strong').textContent = formatInt(groups.length);
    $('#tacticDeckOptions').innerHTML = groups.map(([deck]) => `<option value="${escapeHtml(deck)}"></option>`).join('');
    renderTacticDeckChoices('');
    selectPopularTacticDeck(false);
  }
  function renderTacticDeckChoices(query = '') {
    const normalized = normalizeText(query);
    const groups = sortedTacticGroups().filter(([deck]) => !normalized || normalizeText(deck).includes(normalized)).slice(0, 12);
    $('#tacticDeckRail').innerHTML = groups.length ? groups.map(([deck, rows], index) => {
      const { leaders, aces } = parseDeckLabel(deck);
      const uses = sum(rows.map(item => item.uses));
      const active = deck === state.selectedTacticDeck;
      return `<button class="tactic-deck-choice ${active ? 'is-active' : ''}" type="button" data-tactic-deck="${encodeURIComponent(deck)}">
        <span class="tactic-deck-choice__index">${String(index + 1).padStart(2, '0')}</span>
        <span class="tactic-deck-choice__leaders">${Array.from({ length: 4 }, (_, i) => cardArtHTML(leaders[i] || '', 'leader', 'xs')).join('')}</span>
        <span class="tactic-deck-choice__copy"><b>${escapeHtml(leaders.join(' / '))}</b><small>${escapeHtml(aces.join(' / ') || 'ACEなし')}</small></span>
        <span class="tactic-deck-choice__uses"><strong>${formatInt(uses)}</strong><small>使用</small></span>
      </button>`;
    }).join('') : '<div class="empty-state"><strong>該当するデッキがない</strong>リーダー名かACE名を変えて検索して。</div>';
    hydrateCardImages($('#tacticDeckRail'));
  }
  function selectPopularTacticDeck(showNotice) {
    const groups = sortedTacticGroups();
    if (!groups.length) {
      $('#selectedTacticDeck').innerHTML = '<div class="empty-state">戦術データを読み込めなかった。</div>';
      $('#tacticSequenceList').innerHTML = '';
      return;
    }
    selectTacticDeck(groups[0][0], true);
    if (showNotice) showToast('使用数が最も多いデッキを表示した。');
  }
  function selectTacticDeck(value, exact = false) {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const decks = [...state.prepared.tacticGroups.keys()];
    const matched = decks.find(deck => deck === value) || decks.find(deck => normalizeText(deck) === normalized) || decks.find(deck => normalizeText(deck).includes(normalized));
    if (!matched) {
      renderTacticDeckChoices(value);
      return;
    }
    state.selectedTacticDeck = matched;
    if (exact) $('#tacticDeckSearch').value = matched;
    renderTacticDeckChoices('');
    renderTacticDeck();
  }
  function parseDeckLabel(deck) {
    const parts = String(deck || '').split(/\s*＋\s*/);
    return {
      leaders: String(parts[0] || '').split(/\s*\/\s*/).filter(Boolean),
      aces: String(parts.slice(1).join(' ＋ ') || '').split(/\s*\/\s*/).filter(Boolean)
    };
  }
  function renderTacticDeck() {
    const deck = state.selectedTacticDeck;
    const rows = state.prepared.tacticGroups.get(deck) || [];
    const { leaders, aces } = parseDeckLabel(deck);
    const totalUses = sum(rows.map(item => item.uses));
    const totalWins = sum(rows.map(item => item.wins));
    const totalGames = sum(rows.map(item => item.games));
    $('#selectedTacticDeck').innerHTML = `<div class="selected-deck__main">
      <div class="selected-deck__leaders">${Array.from({ length: 4 }, (_, i) => lineupSlotHTML(leaders[i], 'leader')).join('')}</div>
      <div class="selected-deck__aces"><span>ACE</span>${aces.length ? aces.map(name => cardChipHTML(name, 'ace', true)).join('') : '<b>記録なし</b>'}</div>
    </div>
    <div class="selected-deck__summary"><div><span>並び数</span><strong>${formatInt(rows.length)}</strong></div><div><span>使用数</span><strong>${formatInt(totalUses)}</strong></div><div><span>合計勝率</span><strong>${percent(totalGames ? totalWins / totalGames : 0, 1)}</strong></div></div>`;
    $('#tacticSequenceList').innerHTML = rows.length ? rows.map((item, i) => {
      const steps = item.order.split(/\s*→\s*/).filter(Boolean);
      return `<article class="sequence-card">
        <span class="sequence-rank">${String(i + 1).padStart(2, '0')}</span>
        <div class="sequence-flow">${steps.map((step, j) => `${j ? '<span class="sequence-arrow" aria-hidden="true">→</span>' : ''}<span class="sequence-step">${cardArtHTML(step, 'tactics', 'xs')}<b>${escapeHtml(step)}</b><small>${j + 1}</small></span>`).join('')}</div>
        <div class="sequence-metrics"><div class="sequence-metric"><span>使用</span><strong>${formatInt(item.uses)}</strong></div><div class="sequence-metric"><span>使用率</span><strong>${percent(item.useRate, 1)}</strong></div><div class="sequence-metric sequence-metric--accent"><span>勝率</span><strong>${percent(item.winRate, 1)}</strong><small>${formatInt(item.wins)}勝 / ${formatInt(item.games)}試合</small></div></div>
      </article>`;
    }).join('') : '<div class="empty-state"><strong>このデッキの戦術データがない</strong>別のデッキを選択して。</div>';
    hydrateCardImages($('[data-view-panel="tactics"]'));
    animateVisuals($('[data-view-panel="tactics"]'));
  }

  function initializeMatchup() {
    if (!state.prepared.deckMatchups.length && !state.prepared.synergy.length) {
      $('#matchupPane').innerHTML = '<div class="empty-state"><strong>対面データがない</strong>RawLogsに相手リーダーの記録が必要。</div>';
      $('#synergyPane').innerHTML = '';
      return;
    }
    state.matchupDeck = state.prepared.deckMatchups[0]?.label || '';
    state.synergyLimit = 24;
    renderMatchup();
  }
  function renderMatchup() {
    if (!state.prepared) return;
    const synergy = state.matchupMode === 'synergy';
    $('#matchupPane').hidden = synergy;
    $('#synergyPane').hidden = !synergy;
    $('#matchupSearch').placeholder = synergy ? 'リーダー名で検索' : 'リーダー・ACEでデッキを検索';
    if (synergy) renderSynergy(); else renderMatchupBoard();
    animateVisuals($('[data-view-panel="matchup"]'));
  }

  function renderMatchupBoard() {
    const query = normalizeText($('#matchupSearch').value);
    const decks = state.prepared.deckMatchups;
    const visible = decks.filter(deck => !query || deck.search.includes(query));
    if (visible.length && !visible.some(deck => deck.label === state.matchupDeck)) {
      state.matchupDeck = visible[0].label;
    }
    $('#matchupDeckRail').innerHTML = visible.length ? visible.slice(0, 40).map(deck => `
      <button class="matchup-chip matchup-chip--deck ${deck.label === state.matchupDeck ? 'is-active' : ''}" type="button" data-matchup-deck="${encodeURIComponent(deck.label)}">
        <span class="matchup-chip__cards">${deck.leaders.map(name => cardArtHTML(name, 'leader', 'xs')).join('')}</span>
        <b>${escapeHtml(deck.leaders.join(' / '))}</b>
        <small>${formatInt(deck.games)}試合 / ${percent(deck.winRate, 0)}</small>
      </button>`).join('') : '<div class="empty-state">該当するデッキがない。</div>';

    const deck = decks.find(item => item.label === state.matchupDeck);
    const minGames = Math.max(1, number($('#matchupMinGames').value) || 1);
    const sort = $('#matchupSort').value;
    const sorters = {
      confidence: (a, b) => b.confidence - a.confidence || b.games - a.games,
      winrate: (a, b) => b.winRate - a.winRate || b.games - a.games,
      games: (a, b) => b.games - a.games || b.winRate - a.winRate
    };
    const rows = (deck?.vs || []).filter(row => row.games >= minGames).sort(sorters[sort] || sorters.confidence);
    $('#matchupCountBadge strong').textContent = formatInt(rows.length);

    const best = [...rows].sort((a, b) => b.confidence - a.confidence)[0];
    const worst = [...rows].sort((a, b) => a.confidence - b.confidence)[0];

    $('#matchupDetail').innerHTML = deck ? `
      <div class="panel__head">
        <div><p class="kicker">VS OPPONENT LEADERS</p><h3>このデッキの対面成績</h3></div>
        <span class="panel__meta">MIN ${formatInt(minGames)} GAMES</span>
      </div>
      <div class="matchup-deck">
        <div class="matchup-deck__leaders">${deck.leaders.map(name => lineupCardHTML(name, 'leader')).join('')}</div>
        <div class="matchup-deck__aces"><span>ACE</span>${deck.aces.length ? deck.aces.map(name => cardChipHTML(name, 'ace', true)).join('') : '<b>記録なし</b>'}</div>
      </div>
      <div class="matchup-summary">
        <div class="matchup-summary__metrics">
          <div><span>試合数</span><strong>${formatInt(deck.games)}</strong></div>
          <div><span>勝数</span><strong>${formatInt(deck.wins)}</strong></div>
          <div><span>勝率</span><strong>${percent(deck.winRate, 1)}</strong></div>
          <div><span>信頼下限</span><strong>${percent(deck.confidence, 1)}</strong></div>
        </div>
        <div class="matchup-summary__edges">
          ${edgeHTML('得意', best, 'is-good')}
          ${edgeHTML('苦手', worst, 'is-bad')}
        </div>
      </div>
      <div class="matchup-list">${rows.length ? rows.map(matchupRowHTML).join('')
        : '<div class="empty-state"><strong>条件に合う対面がない</strong>最低試合数を下げて。</div>'}</div>
      <p class="panel__note">相手はリーダー単位で数えている。相手もデッキ単位にすると、この期間では10試合以上の組み合わせが1つも成立しない（最大9試合）ため。
        バーは勝率50%を中心に、右へ伸びるほど有利。</p>`
      : '<div class="empty-state">デッキを選択して。</div>';
    hydrateCardImages($('[data-view-panel="matchup"]'));
  }
  function edgeHTML(label, item, tone) {
    if (!item) return `<div class="matchup-edge"><span>${label}</span><b>—</b></div>`;
    return `<div class="matchup-edge ${tone}"><span>${label}</span><b>${escapeHtml(item.opponent)}</b><i>${percent(item.winRate, 1)} / ${formatInt(item.games)}試合</i></div>`;
  }
  function matchupRowHTML(item) {
    const rate = number(item.winRate);
    const tone = rate >= .55 ? 'is-good' : rate <= .45 ? 'is-bad' : 'is-even';
    return `<div class="matchup-row ${tone}">
      ${cardArtHTML(item.opponent, 'leader', 'xs')}
      <div class="matchup-row__name"><b>${escapeHtml(item.opponent)}</b><small>${formatInt(item.wins)}勝 / ${formatInt(item.games)}試合</small></div>
      ${winBarHTML(rate)}
      <div class="matchup-row__rate"><b>${percent(rate, 1)}</b><small>下限 ${percent(item.confidence, 1)}</small></div>
    </div>`;
  }

  function renderSynergy() {
    const query = normalizeText($('#matchupSearch').value);
    const minGames = Math.max(1, number($('#matchupMinGames').value) || 1);
    const sort = $('#matchupSort').value;
    const sorters = {
      confidence: (a, b) => b.confidence - a.confidence || b.games - a.games,
      winrate: (a, b) => b.winRate - a.winRate || b.games - a.games,
      games: (a, b) => b.games - a.games || b.winRate - a.winRate
    };
    const rows = state.prepared.synergy
      .filter(item => item.games >= minGames && (!query || item.search.includes(query)))
      .sort(sorters[sort] || sorters.confidence);
    $('#matchupCountBadge strong').textContent = formatInt(rows.length);
    const visible = rows.slice(0, state.synergyLimit);
    $('#synergyList').innerHTML = visible.length ? visible.map((item, index) => `
      <article class="synergy-card">
        <span class="synergy-card__rank">${String(index + 1).padStart(2, '0')}</span>
        <div class="synergy-card__pair">
          ${cardArtHTML(item.a, 'leader', 'sm')}
          <span class="synergy-card__plus" aria-hidden="true">＋</span>
          ${cardArtHTML(item.b, 'leader', 'sm')}
        </div>
        <div class="synergy-card__body">
          <h3>${escapeHtml(item.a)} ＋ ${escapeHtml(item.b)}</h3>
          <div class="synergy-card__metrics">
            <div><span>勝率</span><strong>${percent(item.winRate, 1)}</strong></div>
            <div><span>信頼下限</span><strong>${percent(item.confidence, 1)}</strong></div>
            <div><span>試合数</span><strong>${formatInt(item.games)}</strong></div>
          </div>
          ${winBarHTML(item.confidence)}
        </div>
      </article>`).join('')
      : '<div class="empty-state"><strong>条件に合う組み合わせがない</strong>最低試合数か検索語を変えて。</div>';
    const more = $('#synergyMore');
    if (more) more.hidden = visible.length >= rows.length;
    hydrateCardImages($('#synergyList'));
  }

  function getFilteredLogs() {
    const query = normalizeText($('#logSearch').value);
    const turn = $('#logTurn').value;
    const result = $('#logResult').value;
    const lead = $('#logLead').value;
    return state.prepared.logs.filter(log => (!turn || log['先後'] === turn) && (!result || log['結果'] === result) && (!lead || log['進行'] === lead) && (!query || log.__search.includes(query)));
  }
  function renderLogs() {
    if (!state.prepared) return;
    const filtered = getFilteredLogs();
    const totalPages = Math.max(1, Math.ceil(filtered.length / LOG_PAGE_SIZE));
    state.logPage = Math.min(state.logPage, totalPages);
    const pageRows = filtered.slice((state.logPage - 1) * LOG_PAGE_SIZE, state.logPage * LOG_PAGE_SIZE);
    $('#logCountBadge strong').textContent = formatInt(filtered.length);
    $('#logList').innerHTML = pageRows.length ? pageRows.map(log => logCardHTML(log, false)).join('') : '<div class="empty-state"><strong>該当する対戦ログがない</strong>検索条件を変更して。</div>';
    renderPagination($('#logPagination'), state.logPage, totalPages, page => { state.logPage = page; renderLogs(); scrollViewTop(); });
    hydrateCardImages($('#logList'));
    animateVisuals($('[data-view-panel="logs"]'));
  }
  function logCardHTML(log) {
    const selfLeaders = [1,2,3,4].map(i => String(log[`自分リーダー${i}`] || '').trim());
    const opponentLeaders = [1,2,3,4].map(i => String(log[`相手リーダー${i}`] || '').trim());
    const selfAces = Array.from({ length: 8 }, (_, i) => String(log[`自分ACE${i + 1}`] || '').trim()).filter(Boolean);
    const opponentAces = Array.from({ length: 8 }, (_, i) => String(log[`相手ACE${i + 1}`] || '').trim()).filter(Boolean);
    const selfTactics = [1,2,3].map(i => String(log[`自分戦術${i}`] || '').trim()).filter(Boolean);
    const opponentTactics = [1,2,3].map(i => String(log[`相手戦術${i}`] || '').trim()).filter(Boolean);
    const win = log['結果'] === '勝';
    const resultText = win ? 'WIN' : 'LOSE';
    const matchNumber = log['対戦番号'] || '—';
    return `<article class="match-record ${win ? 'is-win' : 'is-lose'}">
      <header class="match-record__head">
        <div class="match-event">
          <div class="match-event__meta"><time>${escapeHtml(formatExcelDate(log['大会日付']))}</time><span>MATCH ${escapeHtml(matchNumber)}</span></div>
          <h3>${escapeHtml(log['大会名'] || '大会名なし')}</h3>
          <p>${escapeHtml(log['ユーザー名'] || '—')}</p>
        </div>
        <div class="match-status">
          <span class="result-badge ${win ? 'result-badge--win' : 'result-badge--lose'}">${resultText}</span>
          <span class="match-tag">${escapeHtml(log['先後'] || '—')}</span>
          <span class="match-tag match-tag--strong">${escapeHtml(log['進行'] || '—')}</span>
        </div>
      </header>
      ${roundTrackHTML(log)}
      <div class="match-board">
        ${matchSideHTML('YOUR DECK', '自分', selfLeaders, selfAces, 'self')}
        <div class="match-vs" aria-hidden="true"><span>VS</span></div>
        ${matchSideHTML('OPPONENT', '相手', opponentLeaders, opponentAces, 'opponent')}
      </div>
      <details class="match-more">
        <summary><span>戦術・メモ</span><i>表示</i></summary>
        <div class="match-more__body">
          <div class="match-tactics-grid">
            ${matchTacticsHTML('自分のタクティクス', selfTactics)}
            ${matchTacticsHTML('相手のタクティクス', opponentTactics)}
          </div>
          ${log['メモ'] ? `<div class="match-note"><b>MEMO</b><p>${escapeHtml(log['メモ'])}</p></div>` : ''}
        </div>
      </details>
    </article>`;
  }
  function matchSideHTML(eyebrow, label, leaders, aces, side) {
    return `<section class="match-side match-side--${side}">
      <div class="match-side__head"><span>${escapeHtml(eyebrow)}</span><b>${escapeHtml(label)}</b></div>
      <div class="match-leaders">${Array.from({ length: 4 }, (_, i) => lineupSlotHTML(leaders[i], 'leader', true)).join('')}</div>
      <div class="match-aces"><span>ACE</span><div>${aces.length ? aces.map(name => cardChipHTML(name, 'ace', true)).join('') : '<b class="match-empty">記録なし</b>'}</div></div>
    </section>`;
  }
  function roundTrackHTML(log) {
    const rounds = [1,2,3].map(i => ({ label: `${i}R`, value: String(log[`${i}R`] || '—') }));
    return `<div class="match-rounds"><span>ROUND RESULT</span><div>${rounds.map(round => {
      const stateClass = round.value === '勝' ? 'is-win' : round.value === '負' ? 'is-lose' : 'is-none';
      const text = round.value === '勝' ? 'WIN' : round.value === '負' ? 'LOSE' : '—';
      return `<span class="round-pill ${stateClass}"><b>${round.label}</b><i>${text}</i></span>`;
    }).join('')}</div></div>`;
  }
  function matchTacticsHTML(label, tactics) {
    return `<section class="match-tactics"><b>${escapeHtml(label)}</b>${tactics.length ? `<div>${tactics.map((name, index) => `<span class="match-tactic"><i>${index + 1}</i><b>${escapeHtml(name)}</b></span>`).join('<span class="match-tactic-arrow">→</span>')}</div>` : '<span class="match-empty">記録なし</span>'}</section>`;
  }
  function lineupSlotHTML(name, role, compact = false) {
    const safeName = String(name || '').trim();
    return `<span class="lineup-card ${compact ? 'lineup-card--compact' : ''} ${safeName ? '' : 'is-empty'}">${cardArtHTML(safeName, role, 'sm')}<b>${escapeHtml(safeName || '—')}</b></span>`;
  }

  function lineupCardHTML(name, role, compact = false) {
    return `<span class="lineup-card ${compact ? 'lineup-card--compact' : ''}">${cardArtHTML(name, role, 'sm')}<b>${escapeHtml(name)}</b></span>`;
  }
  function cardChipHTML(name, role, ace = false) {
    return `<span class="card-chip ${ace ? 'card-chip--ace' : ''}">${cardArtHTML(name, role, 'xs')}<span>${escapeHtml(name)}</span></span>`;
  }
  function cardArtHTML(name, role, size = '') {
    const sizeClass = size ? ` card-art--${size}` : '';
    const roleLabel = role === 'leader' ? 'LEADER' : role === 'ace' ? 'ACE' : role === 'tactics' ? 'TACTICS' : 'CARD';
    return `<span class="card-art${sizeClass}" data-card-image data-card-name="${escapeHtml(name)}" data-card-role="${escapeHtml(role)}"><span class="card-art__fallback"><b>${roleLabel}</b><span>${escapeHtml(name)}</span></span></span>`;
  }
  function cardEntry(name) {
    const map = window.XROSS_CARD_MAP || {};
    const exact = map[String(name || '').trim()];
    if (exact) return exact;
    const original = (window.XROSS_CARD_ALIASES || {})[normalizeText(name)];
    return original ? map[original] : null;
  }
  function candidateImageUrls(name, role) {
    const entry = cardEntry(name);
    const info = entry?.roles?.[role] || Object.values(entry?.roles || {})[0];
    if (!info?.ids?.length) return [];

    // Leader images use the base Unity ID as the public filename.
    // Example: LC6_0 in the master data resolves to assets/cards/LC6.png first.
    const ids = [];
    info.ids.forEach(rawId => {
      const id = String(rawId || '').trim();
      if (!id) return;
      if (role === 'leader') {
        const baseId = id.replace(/_0$/i, '');
        ids.push(baseId);
        if (baseId !== id) ids.push(id); // backward-compatible fallback
      } else {
        ids.push(id);
      }
    });

    const extensions = ['png', 'webp', 'jpg', 'jpeg'];
    return [...new Set(ids)].flatMap(id => extensions.map(ext => `assets/cards/${encodeURIComponent(id)}.${ext}`));
  }
  function resolveCardImage(name, role) {
    const key = `${role}:${name}`;
    if (imageResolutionCache.has(key)) return imageResolutionCache.get(key);
    const candidates = candidateImageUrls(name, role);
    const resolution = new Promise(resolve => {
      if (!candidates.length) return resolve(null);
      const probe = new Image();
      let index = 0;
      const tryNext = () => {
        if (index >= candidates.length) return resolve(null);
        const candidate = candidates[index++];
        probe.onload = () => resolve(candidate);
        probe.onerror = tryNext;
        probe.src = candidate;
      };
      tryNext();
    }).catch(() => null);
    imageResolutionCache.set(key, resolution);
    return resolution;
  }

  function hydrateCardImages(root = document) {
    $$('[data-card-image]:not([data-image-ready])', root).forEach(holder => {
      holder.dataset.imageReady = '1';
      const name = holder.dataset.cardName || '';
      const role = holder.dataset.cardRole || '';
      resolveCardImage(name, role).then(source => {
        if (!source || !holder.isConnected) return;
        const image = new Image();
        image.alt = name;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('load', () => holder.classList.add('has-image'), { once: true });
        image.addEventListener('error', () => image.remove(), { once: true });
        holder.appendChild(image);
        image.src = source;
      });
    });
  }

  function lockApp() {
    sessionStorage.removeItem(SESSION_KEY);
    closeSidebar();
    closeModal();
    state.data = null;
    state.prepared = null;
    state.deckCompare.clear();
    elements.app.hidden = true;
    elements.authScreen.hidden = false;
    document.body.classList.remove('is-unlocked');
    elements.passwordInput.value = '';
    elements.passwordInput.type = 'password';
    elements.togglePassword.textContent = '表示';
    setAuthMessage('');
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => elements.passwordInput.focus());
  }

  function setAuthMessage(message, info = false) {
    elements.authMessage.textContent = message;
    elements.authMessage.classList.toggle('is-info', info);
  }

  function setUnlockLoading(loading) {
    elements.unlockButton.disabled = loading;
    elements.unlockButton.classList.toggle('is-loading', loading);
    elements.passwordInput.disabled = loading;
  }

  function switchView(view, updateHash = true) {
    const targetRoute = ROUTES.find(route => route.key === view);
    if (!targetRoute) return;

    closeSidebar();
    if (state.isTransitioning) {
      state.pendingView = view;
      return;
    }

    const currentPanel = $(`[data-view-panel="${state.activeView}"]`);
    const nextPanel = $(`[data-view-panel="${view}"]`);
    if (!nextPanel) return;

    if (view === state.activeView || !currentPanel || elements.app.hidden || prefersReducedMotion.matches) {
      state.activeView = view;
      $$('[data-view-panel]').forEach(panel => panel.classList.toggle('is-active', panel === nextPanel));
      updateNavigation(view);
      if (updateHash) history.replaceState(null, '', `#${view}`);
      window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? 'auto' : 'smooth' });
      resetPanelVisuals(nextPanel);
      playMotion(nextPanel);
      hydrateCardImages(nextPanel);
      animateVisuals(nextPanel);
      return;
    }

    const fromIndex = ROUTES.findIndex(route => route.key === state.activeView);
    const toIndex = ROUTES.findIndex(route => route.key === view);
    const direction = toIndex >= fromIndex ? 'forward' : 'reverse';
    runRouteTransition(currentPanel, nextPanel, targetRoute, direction, updateHash);
  }

  async function runRouteTransition(currentPanel, nextPanel, targetRoute, direction, updateHash) {
    state.isTransitioning = true;
    state.pendingView = null;
    document.body.classList.add('is-route-transitioning');
    updateNavigation(targetRoute.key, true);
    prepareRouteOverlay(targetRoute, direction);

    currentPanel.classList.remove('is-route-entering', 'route-forward', 'route-reverse');
    currentPanel.classList.add('is-route-leaving', `route-${direction}`);

    await wait(245);

    currentPanel.classList.remove('is-active', 'is-route-leaving', 'route-forward', 'route-reverse', 'is-motion-ready');
    nextPanel.classList.remove('is-motion-ready');
    resetPanelVisuals(nextPanel);
    nextPanel.classList.add('is-active', 'is-route-entering', `route-${direction}`);
    state.activeView = targetRoute.key;
    if (updateHash) history.replaceState(null, '', `#${targetRoute.key}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
    hydrateCardImages(nextPanel);

    await wait(285);
    playMotion(nextPanel);
    animateVisuals(nextPanel);

    await wait(430);

    nextPanel.classList.remove('is-route-entering', 'route-forward', 'route-reverse');
    elements.routeTransition.className = 'route-transition';
    document.body.classList.remove('is-route-transitioning');
    updateNavigation(targetRoute.key, false);
    state.isTransitioning = false;

    const pending = state.pendingView;
    state.pendingView = null;
    if (pending && pending !== state.activeView) switchView(pending);
  }

  function prepareRouteOverlay(route, direction) {
    elements.routeTransitionIndex.textContent = route.index;
    elements.routeTransitionTitle.textContent = route.title;
    elements.routeTransitionLabel.textContent = route.label;
    elements.routeTransition.className = `route-transition is-running is-${direction}`;
    void elements.routeTransition.offsetWidth;
  }

  function updateNavigation(view, transitioning = false) {
    $$('[data-view]').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      button.classList.toggle('is-transition-target', active && transitioning);
      if (button.closest('nav')) button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function resetPanelVisuals(panel) {
    $$('[data-bar]', panel).forEach(bar => { bar.style.width = '0'; });
    $$('[data-counter]', panel).forEach(counter => {
      counter.dataset.counted = '0';
      const unit = counter.querySelector('small')?.outerHTML || '';
      counter.innerHTML = `0${unit}`;
    });
  }

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function openSidebar() { elements.sidebar.classList.add('is-open'); }
  function closeSidebar() { elements.sidebar.classList.remove('is-open'); }

  function animateVisuals(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('[data-bar]', root).forEach(bar => { bar.style.width = bar.dataset.bar; });
      $$('[data-counter]', root).forEach(counter => animateCounter(counter));
    }));
  }
  function animateCounter(element) {
    if (element.dataset.counted === '1') return;
    element.dataset.counted = '1';
    const target = number(element.dataset.counter);
    const unit = element.querySelector('small')?.outerHTML || '';
    const started = performance.now();
    const duration = 850;
    const tick = now => {
      const progress = Math.min((now - started) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.innerHTML = `${formatInt(Math.round(target * eased))}${unit}`;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function playMotion(panel) {
    panel.classList.remove('is-motion-ready');
    void panel.offsetWidth;
    panel.classList.add('is-motion-ready');
  }

  function renderPagination(container, current, total, onChange) {
    if (total <= 1) { container.innerHTML = ''; return; }
    const pages = new Set([1,total,current-2,current-1,current,current+1,current+2]);
    const valid = [...pages].filter(page => page >= 1 && page <= total).sort((a,b) => a-b);
    const html = [`<button type="button" data-page="${current-1}" ${current === 1 ? 'disabled' : ''}>‹</button>`];
    let last = 0;
    for (const page of valid) {
      if (page - last > 1) html.push('<span>…</span>');
      html.push(`<button class="${page === current ? 'is-active' : ''}" type="button" data-page="${page}">${page}</button>`);
      last = page;
    }
    html.push(`<button type="button" data-page="${current+1}" ${current === total ? 'disabled' : ''}>›</button>`);
    container.innerHTML = html.join('');
    $$('[data-page]', container).forEach(button => button.addEventListener('click', () => {
      const page = number(button.dataset.page);
      if (page >= 1 && page <= total && page !== current) onChange(page);
    }));
  }

  function openModal(html) {
    elements.modalContent.innerHTML = html;
    if (!elements.modal.open) elements.modal.showModal();
    hydrateCardImages(elements.modalContent);
  }
  function closeModal() { if (elements.modal.open) elements.modal.close(); elements.modalContent.innerHTML = ''; }
  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    state.toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3000);
  }
  function scrollViewTop() { elements.mainContent.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function formatExcelDate(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDateObject(new Date(value));
    const serial = number(value);
    if (!serial) return String(value);
    return formatDateObject(new Date(Date.UTC(1899, 11, 30) + serial * 86400000));
  }
  function formatDateTime(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(date);
      return value;
    }
    const serial = number(value);
    if (!serial) return String(value);
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return new Intl.DateTimeFormat('ja-JP', { timeZone:'UTC', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(date);
  }
  function formatDateObject(date) { return new Intl.DateTimeFormat('ja-JP', { timeZone:'UTC', year:'numeric', month:'2-digit', day:'2-digit' }).format(date); }
  function percent(value, digits = 1) { return `${(number(value) * 100).toFixed(digits)}%`; }
  function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  function formatInt(value) { return new Intl.NumberFormat('ja-JP').format(number(value)); }
  function normalizeText(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
  function intersectionSize(a,b) { const setB = new Set(b); return new Set(a.filter(item => setB.has(item))).size; }
  function sum(values) { return values.reduce((total, value) => total + number(value), 0); }
})();
