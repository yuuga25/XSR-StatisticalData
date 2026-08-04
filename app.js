(() => {
  'use strict';

  const DATA_URL = 'data.enc';
  const MAGIC = 'XSD1';
  const AAD_TEXT = 'Xross Stats Dashboard v1';
  const PBKDF2_ITERATIONS = 350000;
  const SESSION_KEY = 'xrossStatsSessionPassword';
  const LOG_PAGE_SIZE = 24;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    authScreen: $('#authScreen'), authForm: $('#authForm'), passwordInput: $('#passwordInput'),
    rememberSession: $('#rememberSession'), unlockButton: $('#unlockButton'), togglePassword: $('#togglePassword'),
    authMessage: $('#authMessage'), app: $('#app'), sidebar: $('#sidebar'), menuButton: $('#menuButton'),
    closeMenuButton: $('#closeMenuButton'), sidebarScrim: $('#sidebarScrim'), lockButton: $('#lockButton'),
    modal: $('#modal'), modalContent: $('#modalContent'), toast: $('#toast'), mainContent: $('#mainContent'),
    routeTransition: $('#routeTransition'), routeTransitionIndex: $('#routeTransitionIndex'),
    routeTransitionTitle: $('#routeTransitionTitle'), routeTransitionLabel: $('#routeTransitionLabel')
  };

  const state = {
    encryptedBuffer: null, data: null, prepared: null, activeView: 'overview',
    deckMode: 'all', deckLimit: 30, deckCompare: new Map(), cardType: 'leader',
    selectedTacticDeck: '', logPage: 1, toastTimer: null,
    isTransitioning: false, pendingView: null
  };
  const imageResolutionCache = new Map();
  const ROUTES = [
    { key: 'overview', index: '01', title: 'OVERVIEW', label: '概要' },
    { key: 'decks', index: '02', title: 'DECK ANALYSIS', label: 'デッキ' },
    { key: 'cards', index: '03', title: 'CARD PERFORMANCE', label: 'カード統計' },
    { key: 'tactics', index: '04', title: 'TACTICS ORDER', label: '戦術構成' },
    { key: 'logs', index: '05', title: 'MATCH RECORDS', label: '対戦ログ' }
  ];
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    await fetchEncryptedData();
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
      tacticTimer = setTimeout(() => selectTacticDeck(event.target.value), 180);
    });
    $('#tacticDeckSearch').addEventListener('change', event => selectTacticDeck(event.target.value, true));
    $('#popularTacticDeck').addEventListener('click', () => selectPopularTacticDeck(true));

    ['logSearch', 'logTurn', 'logResult', 'logLead'].forEach(id => {
      $(`#${id}`).addEventListener(id === 'logSearch' ? 'input' : 'change', () => { state.logPage = 1; renderLogs(); });
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
      setAuthMessage('統計データを読み込めなかった。公開ファイルを確認して。');
    }
  }

  async function attemptUnlock(password, automatic) {
    if (!state.encryptedBuffer) return setAuthMessage('統計データがまだ読み込めていない。');
    setLoading(true);
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
      setLoading(false);
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
    switchView(['overview', 'decks', 'cards', 'tactics', 'logs'].includes(hashView) ? hashView : 'overview', false);
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
      { key: 'leader', label: 'リーダー', role: 'leader', sheet: 'G2_LeaderStats', nameKey: 'リーダー名', countKey: '採用数', rateKey: '採用率' },
      { key: 'ace', label: 'ACE', role: 'ace', sheet: 'G3_AceStats', nameKey: 'ACE名', countKey: '採用数', rateKey: '採用率' },
      { key: 'tactics', label: 'タクティクス', role: 'tactics', sheet: 'G4_TacticStats', nameKey: 'タクティクス名', countKey: '使用数', rateKey: '使用率' }
    ].filter(config => data.sheets?.[config.sheet]);
    const cardGroups = cardConfigs.map(config => ({
      ...config,
      items: recordsFromSheet(data, config.sheet, 1).map((record, i) => normalizeCardStat(record, config, i))
    }));
    const tacticGroups = new Map();
    for (const row of recordsFromSheet(data, '_T1_Data', 1)) {
      const deck = String(row['デッキ'] || '').trim();
      if (!deck) continue;
      if (!tacticGroups.has(deck)) tacticGroups.set(deck, []);
      tacticGroups.get(deck).push({
        order: String(row['タクティクス並び'] || ''), uses: number(row['使用数']), useRate: number(row['使用率']),
        games: number(row['試合数']), wins: number(row['勝数']), winRate: number(row['勝率'])
      });
    }
    for (const list of tacticGroups.values()) list.sort((a, b) => b.uses - a.uses || b.games - a.games);
    const logs = recordsFromSheet(data, 'RawLogs', 1).map((record, index) => ({
      ...record, __index: index, __search: normalizeText(Object.values(record).filter(value => value != null).join(' '))
    }));
    return {
      summary, decks, cardGroups,
      firstSecond: recordsFromSheet(data, 'G1_FirstSecond', 1),
      leadStats: recordsFromSheet(data, 'G5_LeadWinRate', 1),
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
    return {
      key: config.key, role: config.role, rank: index + 1, name: String(record[config.nameKey] || ''),
      count: number(record[config.countKey]), adoptionRate: number(record[config.rateKey]), games: number(record['試合数']),
      wins: number(record['勝数']), winRate: number(record['勝率']), raw: record
    };
  }

  function renderAll() {
    renderOverview();
    renderDecks();
    renderCardTabs();
    renderCards();
    initializeTactics();
    renderLogs();
  }

  function renderOverview() {
    const { meta, firstSecond, leadStats, decks, cardGroups, summary } = state.prepared;
    const first = firstSecond.find(row => row['先後'] === '先攻') || {};
    const second = firstSecond.find(row => row['先後'] === '後攻') || {};
    const firstRate = number(first['勝率']);
    const delta = firstRate - number(second['勝率']);
    $('#overviewLead').textContent = `${formatInt(meta.games)}試合、${formatInt(meta.users)}人、${formatInt(meta.decks)}種のデッキから現在の対戦環境を整理。`;
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
    $('#insightStrip').innerHTML = `<span class="insight-strip__icon">X</span><p><strong>先攻が後攻を${Math.abs(delta * 100).toFixed(1)}ポイント${delta >= 0 ? '上回る' : '下回る'}。</strong> 進行別データとあわせて、初動の影響を確認できる。</p><span class="insight-strip__tag">KEY SIGNAL</span>`;
    $('#turnOrderChart').innerHTML = firstSecond.map((row, index) => `
      <div class="turn-row">
        <div class="turn-row__label"><strong>${escapeHtml(row['先後'])}</strong><small>${formatInt(row['試合数'])}試合</small></div>
        <div class="rate-bar"><i data-bar="${Math.max(number(row['勝率']) * 100, 1)}%" style="--bar-gradient:${index === 0 ? 'linear-gradient(90deg,var(--cyan),var(--violet))' : 'linear-gradient(90deg,#7b86a9,var(--magenta))'}"></i></div>
        <div class="turn-row__rate">${percent(row['勝率'], 1)}</div>
      </div>`).join('') + `<div class="turn-delta"><span>先後差</span><strong>${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pt</strong></div>`;
    const leadTotal = leadStats.filter(row => row['先後'] === '合計');
    $('#leadFlowChart').innerHTML = leadTotal.map((row, i) => `
      <div class="flow-card" style="--flow-color:${i === 0 ? 'var(--violet)' : 'var(--magenta)'}">
        <div class="flow-card__head"><h4>${escapeHtml(row['進行'])}</h4><strong>${percent(row['勝率'], 1)}</strong></div>
        <div class="flow-card__meta"><span>${formatInt(row['勝数'])}勝 / ${formatInt(row['試合数'])}試合</span><span>構成比 ${percent(row['構成比'], 1)}</span></div>
        <div class="rate-bar"><i data-bar="${Math.max(number(row['勝率']) * 100, 1)}%" style="--bar-gradient:linear-gradient(90deg,${i === 0 ? 'var(--cyan),var(--violet)' : '#f28aa0,var(--magenta)'})"></i></div>
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
    const noteKeys = ['記載方針', 'qualityScore定義', '進行の定義', 'RawLogsの色', '信頼下限'];
    $('#summaryNotes').innerHTML = noteKeys.filter(key => summary.has(key)).map(key => `<div class="note"><b>${escapeHtml(key)}</b><p>${escapeHtml(summary.get(key))}</p></div>`).join('');
    hydrateCardImages($('[data-view-panel="overview"]'));
    animateVisuals($('[data-view-panel="overview"]'));
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
          <div class="deck-lineup__leaders">${deck.leaders.map(name => cardChipHTML(name, 'leader')).join('')}</div>
          <div class="deck-lineup__aces">${deck.aces.map(name => cardChipHTML(name, 'ace', true)).join('')}</div>
        </div>
        <div class="deck-metrics">
          <div class="deck-metric"><span>試合</span><strong>${formatInt(deck.games)}</strong></div>
          <div class="deck-metric"><span>勝数</span><strong>${formatInt(deck.wins)}</strong></div>
          <div class="deck-metric deck-metric--accent"><span>勝率</span><strong>${percent(deck.winRate, 1)}</strong></div>
          <div class="deck-metric"><span>信頼下限</span><strong>${percent(deck.confidence, 1)}</strong></div>
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
      winrate: (a,b) => b.winRate - a.winRate || b.games - a.games,
      games: (a,b) => b.games - a.games || b.winRate - a.winRate,
      count: (a,b) => b.count - a.count || b.adoptionRate - a.adoptionRate
    };
    const list = [...group.items].filter(item => !query || normalizeText(item.name).includes(query)).sort(sorters[sort] || sorters.adoption);
    const maxRate = Math.max(...list.map(item => item.adoptionRate), .01);
    $('#cardCountBadge strong').textContent = formatInt(list.length);
    $('#cardStatsList').innerHTML = list.length ? list.map((item, index) => `<article class="card-stat">
      <span class="card-stat__rank">${String(index + 1).padStart(2, '0')}</span>
      ${cardArtHTML(item.name, group.role, 'lg')}
      <div class="card-stat__body"><h3>${escapeHtml(item.name)}</h3>
        <div class="card-stat__headline"><div><span>${group.key === 'tactics' ? '使用率' : '採用率'}</span><strong>${percent(item.adoptionRate, 1)}</strong></div><div><span>勝率</span><strong>${percent(item.winRate, 1)}</strong></div></div>
        <div class="card-stat__bar"><div class="rate-bar"><i data-bar="${Math.max(item.adoptionRate / maxRate * 100, 1)}%"></i></div></div>
        <div class="card-stat__minor"><div><span>${group.key === 'tactics' ? '使用数' : '採用数'}</span><strong>${formatInt(item.count)}</strong></div><div><span>試合数</span><strong>${formatInt(item.games)}</strong></div><div><span>勝数</span><strong>${formatInt(item.wins)}</strong></div></div>
      </div>
    </article>`).join('') : '<div class="empty-state"><strong>該当するカードがない</strong>検索語を変えて。</div>';
    hydrateCardImages($('#cardStatsList'));
    animateVisuals($('[data-view-panel="cards"]'));
  }

  function initializeTactics() {
    const decks = [...state.prepared.tacticGroups.keys()];
    $('#tacticDeckCount strong').textContent = formatInt(decks.length);
    $('#tacticDeckOptions').innerHTML = decks.map(deck => `<option value="${escapeHtml(deck)}"></option>`).join('');
    selectPopularTacticDeck(false);
  }
  function selectPopularTacticDeck(showNotice) {
    const groups = [...state.prepared.tacticGroups.entries()].sort((a,b) => sum(b[1].map(item => item.uses)) - sum(a[1].map(item => item.uses)));
    if (!groups.length) return;
    state.selectedTacticDeck = groups[0][0];
    $('#tacticDeckSearch').value = state.selectedTacticDeck;
    renderTacticDeck();
    if (showNotice) showToast('使用数が最も多いデッキを表示した。');
  }
  function selectTacticDeck(value, exact = false) {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const decks = [...state.prepared.tacticGroups.keys()];
    const matched = decks.find(deck => deck === value) || decks.find(deck => normalizeText(deck).includes(normalized));
    if (!matched) return;
    state.selectedTacticDeck = matched;
    if (exact) $('#tacticDeckSearch').value = matched;
    renderTacticDeck();
  }
  function renderTacticDeck() {
    const deck = state.selectedTacticDeck;
    const rows = state.prepared.tacticGroups.get(deck) || [];
    const [leaderText = '', aceText = ''] = deck.split(' ＋ ');
    const leaders = leaderText.split(' / ').filter(Boolean);
    const aces = aceText.split(' / ').filter(Boolean);
    const totalUses = sum(rows.map(item => item.uses));
    $('#selectedTacticDeck').innerHTML = `<div><div class="selected-deck__lineup">${leaders.map(name => cardChipHTML(name, 'leader')).join('')}${aces.map(name => cardChipHTML(name, 'ace', true)).join('')}</div><div class="selected-deck__title"><h3>${escapeHtml(leaderText)}</h3><p>${escapeHtml(aceText)}</p></div></div><div class="selected-deck__uses"><strong>${formatInt(totalUses)}</strong><span>タクティクス使用数</span></div>`;
    $('#tacticSequenceList').innerHTML = rows.length ? rows.map((item, i) => {
      const steps = item.order.split(' → ').filter(Boolean);
      return `<article class="sequence-card"><div class="sequence-flow">${steps.map((step, j) => `${j ? '<span class="sequence-arrow">→</span>' : ''}<span class="sequence-step">${cardArtHTML(step, 'tactics', 'xs')}<span>${escapeHtml(step)}</span></span>`).join('')}</div><div class="sequence-metrics"><div class="sequence-metric"><span>使用数</span><strong>${formatInt(item.uses)}</strong></div><div class="sequence-metric"><span>使用率</span><strong>${percent(item.useRate, 1)}</strong></div><div class="sequence-metric sequence-metric--accent"><span>勝率</span><strong>${percent(item.winRate, 1)}</strong></div></div></article>`;
    }).join('') : '<div class="empty-state">このデッキのタクティクスデータがない。</div>';
    hydrateCardImages($('[data-view-panel="tactics"]'));
    animateVisuals($('[data-view-panel="tactics"]'));
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
    $('#logList').innerHTML = pageRows.length ? pageRows.map((log, i) => logCardHTML(log, i === 0 && state.logPage === 1)).join('') : '<div class="empty-state"><strong>該当する対戦ログがない</strong>検索条件を変更して。</div>';
    renderPagination($('#logPagination'), state.logPage, totalPages, page => { state.logPage = page; renderLogs(); scrollViewTop(); });
    hydrateCardImages($('#logList'));
    animateVisuals($('[data-view-panel="logs"]'));
  }
  function logCardHTML(log, open) {
    const selfLeaders = [1,2,3,4].map(i => log[`自分リーダー${i}`]).filter(Boolean);
    const opponentLeaders = [1,2,3,4].map(i => log[`相手リーダー${i}`]).filter(Boolean);
    const selfAces = [log['自分ACE1'], log['自分ACE2']].filter(Boolean);
    const selfTactics = [1,2,3].map(i => log[`自分戦術${i}`]).filter(Boolean);
    const opponentTactics = [1,2,3].map(i => log[`相手戦術${i}`]).filter(Boolean);
    const win = log['結果'] === '勝';
    return `<details class="log-card" ${open ? 'open' : ''}>
      <summary class="log-card__summary">
        <div class="log-card__event"><time>${escapeHtml(formatExcelDate(log['大会日付']))}</time><h3>${escapeHtml(log['大会名'] || '大会名なし')}</h3><p>${escapeHtml(log['ユーザー名'] || '—')} / 第${escapeHtml(log['対戦番号'] || '—')}戦</p></div>
        <div class="log-card__lineup">${selfLeaders.map(name => cardArtHTML(name, 'leader', 'sm')).join('')}${selfAces.map(name => cardArtHTML(name, 'ace', 'sm')).join('')}</div>
        <div class="log-card__result"><span class="result-badge ${win ? 'result-badge--win' : 'result-badge--lose'}">${win ? 'WIN' : 'LOSE'}</span><div><span>${escapeHtml(log['先後'] || '—')}</span><strong>${escapeHtml(log['進行'] || '—')}</strong></div></div>
      </summary>
      <div class="log-card__details"><div class="log-versus">
        <div class="log-side"><div class="log-side__label"><span>YOUR TEAM</span><span>${escapeHtml(log['先後'] || '')}</span></div><div class="log-side__cards">${selfLeaders.map(name => cardChipHTML(name, 'leader')).join('')}${selfAces.map(name => cardChipHTML(name, 'ace', true)).join('')}</div><div class="log-side__tactics"><b>TACTICS</b><br>${selfTactics.length ? escapeHtml(selfTactics.join(' → ')) : '—'}</div></div>
        <div class="log-vs">VS</div>
        <div class="log-side"><div class="log-side__label"><span>OPPONENT</span><span></span></div><div class="log-side__cards">${opponentLeaders.map(name => cardChipHTML(name, 'leader')).join('')}</div><div class="log-side__tactics"><b>TACTICS</b><br>${opponentTactics.length ? escapeHtml(opponentTactics.join(' → ')) : '—'}</div></div>
      </div>${log['メモ'] ? `<p class="log-note">${escapeHtml(log['メモ'])}</p>` : ''}</div>
    </details>`;
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
    return [...new Set(info.ids.map(id => `assets/cards/${encodeURIComponent(id)}.png`))];
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
  function lockApp() {
    sessionStorage.removeItem(SESSION_KEY);
    state.data = null; state.prepared = null;
    elements.app.hidden = true;
    elements.authScreen.hidden = false;
    document.body.classList.remove('is-unlocked');
    elements.passwordInput.value = '';
    setAuthMessage('ロックした。', true);
    elements.passwordInput.focus();
  }

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
  function setAuthMessage(message, info = false) {
    elements.authMessage.textContent = message;
    elements.authMessage.classList.toggle('is-info', info);
  }
  function setLoading(loading) {
    elements.unlockButton.disabled = loading;
    elements.unlockButton.classList.toggle('is-loading', loading);
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
