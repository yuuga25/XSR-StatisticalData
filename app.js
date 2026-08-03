(() => {
  'use strict';

  const DATA_URL = 'data.enc';
  const MAGIC = 'XSD1';
  const AAD_TEXT = 'Xross Stats Dashboard v1';
  const PBKDF2_ITERATIONS = 350000;
  const SESSION_KEY = 'xrossStatsSessionPassword';
  const PAGE_SIZE_LOGS = 40;
  const PAGE_SIZE_RAW = 50;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    authScreen: $('#authScreen'),
    authForm: $('#authForm'),
    passwordInput: $('#passwordInput'),
    rememberSession: $('#rememberSession'),
    unlockButton: $('#unlockButton'),
    togglePassword: $('#togglePassword'),
    authMessage: $('#authMessage'),
    encryptedFileInput: $('#encryptedFileInput'),
    app: $('#app'),
    sidebar: $('#sidebar'),
    sidebarToggle: $('#sidebarToggle'),
    mainContent: $('#mainContent'),
    modal: $('#modal'),
    modalContent: $('#modalContent'),
    toast: $('#toast'),
    localXlsxInput: $('#localXlsxInput'),
    reloadDataButton: $('#reloadDataButton'),
    lockButton: $('#lockButton'),
  };

  const state = {
    encryptedBuffer: null,
    data: null,
    prepared: null,
    activeView: 'overview',
    deckMode: 'all',
    deckLimit: 30,
    deckCompare: new Map(),
    cardType: 'leader',
    selectedTacticDeck: '',
    logPage: 1,
    rawPage: 1,
    rawSheet: '',
    toastTimer: null,
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindGlobalEvents();
    await fetchEncryptedData();

    const sessionPassword = sessionStorage.getItem(SESSION_KEY);
    if (sessionPassword && state.encryptedBuffer) {
      elements.passwordInput.value = sessionPassword;
      await attemptUnlock(sessionPassword, true);
    } else {
      elements.passwordInput.focus();
    }
  }

  function bindGlobalEvents() {
    elements.authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = elements.passwordInput.value;
      if (!password) {
        setAuthMessage('パスワードを入力してね。');
        return;
      }
      await attemptUnlock(password, false);
    });

    elements.togglePassword.addEventListener('click', () => {
      const isPassword = elements.passwordInput.type === 'password';
      elements.passwordInput.type = isPassword ? 'text' : 'password';
      elements.togglePassword.textContent = isPassword ? '隠す' : '表示';
      elements.togglePassword.setAttribute('aria-label', isPassword ? 'パスワードを隠す' : 'パスワードを表示');
    });

    elements.encryptedFileInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      state.encryptedBuffer = await file.arrayBuffer();
      setAuthMessage(`${file.name}を選択した。パスワードを入力して開いてね。`, true);
    });

    elements.lockButton.addEventListener('click', lockApp);
    elements.reloadDataButton.addEventListener('click', () => elements.localXlsxInput.click());
    elements.localXlsxInput.addEventListener('change', handleLocalWorkbook);

    elements.sidebarToggle.addEventListener('click', () => elements.sidebar.classList.toggle('is-open'));

    document.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-view]');
      if (nav) {
        switchView(nav.dataset.view);
        return;
      }

      const jump = event.target.closest('[data-jump-view]');
      if (jump) {
        switchView(jump.dataset.jumpView);
        return;
      }

      if (event.target.closest('[data-close-modal]')) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !elements.modal.hidden) closeModal();
    });

    bindDeckEvents();
    bindCardEvents();
    bindTacticEvents();
    bindLogEvents();
    bindRawEvents();
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
      setAuthMessage('data.encを読み込めなかった。ローカル確認なら「暗号化データを選ぶ」から指定してね。');
    }
  }

  async function attemptUnlock(password, isAutomatic) {
    if (!state.encryptedBuffer) {
      setAuthMessage('暗号化データがまだ選ばれていない。');
      return;
    }

    setUnlockLoading(true);
    setAuthMessage(isAutomatic ? '保存済みセッションを確認中…' : '復号している…', true);

    try {
      const data = await decryptPayload(state.encryptedBuffer, password);
      validatePayload(data);
      if (elements.rememberSession.checked) sessionStorage.setItem(SESSION_KEY, password);
      else sessionStorage.removeItem(SESSION_KEY);
      loadData(data);
      elements.authScreen.hidden = true;
      elements.app.hidden = false;
      setAuthMessage('');
    } catch (error) {
      console.error(error);
      sessionStorage.removeItem(SESSION_KEY);
      setAuthMessage('パスワードが違うか、暗号化データが壊れているみたい。');
      if (!isAutomatic) elements.passwordInput.select();
    } finally {
      setUnlockLoading(false);
    }
  }

  async function decryptPayload(buffer, password) {
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength < 49) throw new Error('Encrypted file is too small');
    const magic = new TextDecoder().decode(bytes.slice(0, 4));
    if (magic !== MAGIC) throw new Error('Unknown encrypted format');

    const salt = bytes.slice(4, 20);
    const iv = bytes.slice(20, 32);
    const ciphertext = bytes.slice(32);
    const encoder = new TextEncoder();

    const material = await crypto.subtle.importKey(
      'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(AAD_TEXT), tagLength: 128 },
      key,
      ciphertext
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function validatePayload(data) {
    if (!data || data.format !== 'xross-stats-data' || !data.sheets) {
      throw new Error('Invalid payload');
    }
  }

  function loadData(data, sourceMode = 'encrypted') {
    state.data = data;
    state.prepared = prepareData(data);
    state.deckMode = 'all';
    state.deckLimit = 30;
    state.deckCompare.clear();
    state.cardType = 'leader';
    state.logPage = 1;
    state.rawPage = 1;
    state.rawSheet = data.sheetOrder?.[0] || Object.keys(data.sheets)[0] || '';

    renderAll();
    switchView(state.activeView, false);

    $('#sourceFileName').textContent = data.sourceFile || 'data.enc';
    $('#sidebarPeriod').textContent = state.prepared.meta.period || '—';
    $('#topLastUpdated').textContent = state.prepared.meta.lastUpdated ? `更新 ${state.prepared.meta.lastUpdated}` : '';
    $('#syncStatus').innerHTML = `<i></i>${sourceMode === 'workbook' ? 'Excelを一時読込中' : 'データ読込済み'}`;
  }

  function prepareData(data) {
    const summaryRows = getSheetRows(data, 'Summary');
    const summary = new Map(summaryRows.filter(row => row?.[0] != null).map(row => [String(row[0]), row[1]]));

    const decksAll = recordsFromSheet(data, 'D1_DeckWinRate_All', 1).map((record, index) => normalizeDeck(record, 'all', index));
    const decksWin = recordsFromSheet(data, 'D2_DeckWinRate_WinLead', 1).map((record, index) => normalizeDeck(record, 'win', index));
    const decksLose = recordsFromSheet(data, 'D3_DeckWinRate_LoseLead', 1).map((record, index) => normalizeDeck(record, 'lose', index));
    const firstSecond = recordsFromSheet(data, 'G1_FirstSecond', 1);
    const leaders = recordsFromSheet(data, 'G2_LeaderStats', 1).map((r, i) => normalizeCardStat(r, 'leader', i));
    const aces = recordsFromSheet(data, 'G3_AceStats', 1).map((r, i) => normalizeCardStat(r, 'ace', i));
    const tactics = recordsFromSheet(data, 'G4_TacticStats', 1).map((r, i) => normalizeCardStat(r, 'tactic', i));
    const leadStats = recordsFromSheet(data, 'G5_LeadWinRate', 1);
    const tacticRows = recordsFromSheet(data, '_T1_Data', 1);
    const logs = recordsFromSheet(data, 'RawLogs', 1);

    const tacticGroups = new Map();
    for (const row of tacticRows) {
      const deck = String(row['デッキ'] || '').trim();
      if (!deck) continue;
      if (!tacticGroups.has(deck)) tacticGroups.set(deck, []);
      tacticGroups.get(deck).push({
        order: String(row['タクティクス並び'] || ''),
        uses: number(row['使用数']),
        useRate: number(row['使用率']),
        games: number(row['試合数']),
        wins: number(row['勝数']),
        winRate: number(row['勝率']),
      });
    }
    for (const list of tacticGroups.values()) list.sort((a, b) => b.uses - a.uses || b.games - a.games);

    return {
      summary,
      decks: { all: decksAll, win: decksWin, lose: decksLose },
      firstSecond,
      leaders,
      aces,
      tactics,
      leadStats,
      tacticGroups,
      logs,
      rawHeaders: getSheetRows(data, 'RawLogs')[1] || [],
      meta: {
        period: String(summary.get('集計対象期間（大会日付）') || '—'),
        games: number(summary.get('対象試合数')),
        logs: number(summary.get('対象ログ数')),
        users: number(summary.get('ユニークユーザー数')),
        decks: number(summary.get('ユニークデッキ数（リーダー4+ACE）')),
        minGames: number(summary.get('最低試合数 N（変更可）')) || 0,
        lastUpdated: formatDateTime(summary.get('最終更新')),
      },
    };
  }

  function getSheetRows(data, name) {
    return data.sheets?.[name]?.rows || [];
  }

  function recordsFromSheet(data, name, headerIndex = 1) {
    const rows = getSheetRows(data, name);
    const headers = (rows[headerIndex] || []).map((value, index) => value == null || value === '' ? `列${index + 1}` : String(value));
    return rows.slice(headerIndex + 1)
      .filter(row => row?.some(value => value !== null && value !== ''))
      .map((row, rowIndex) => {
        const record = { __row: rowIndex + headerIndex + 2 };
        headers.forEach((header, index) => { record[header] = row[index] ?? null; });
        return record;
      });
  }

  function normalizeDeck(record, mode, index) {
    const leaders = [1, 2, 3, 4].map(i => String(record[`リーダー${i}`] || '')).filter(Boolean);
    const aceText = String(record['ACE'] || '');
    const aces = aceText.split(' / ').map(v => v.trim()).filter(Boolean);
    return {
      uid: `${mode}-${index}`,
      mode,
      rank: number(record['順位']) || index + 1,
      leaders,
      aces,
      aceText,
      games: number(record['試合数']),
      wins: number(record['勝数']),
      winRate: number(record['勝率']),
      confidence: number(record['信頼下限']),
      category: String(record['区分'] || ''),
      raw: record,
      search: normalizeText([...leaders, ...aces].join(' ')),
    };
  }

  function normalizeCardStat(record, type, index) {
    const isTactic = type === 'tactic';
    const nameKey = type === 'leader' ? 'リーダー名' : type === 'ace' ? 'ACE名' : 'タクティクス名';
    const countKey = isTactic ? '使用数' : '採用数';
    const rateKey = isTactic ? '使用率' : '採用率';
    return {
      type,
      rank: index + 1,
      name: String(record[nameKey] || ''),
      count: number(record[countKey]),
      adoptionRate: number(record[rateKey]),
      games: number(record['試合数']),
      wins: number(record['勝数']),
      winRate: number(record['勝率']),
      raw: record,
    };
  }

  function renderAll() {
    renderOverview();
    initializeDeckControls();
    renderDecks();
    renderCards();
    initializeTactics();
    renderLogs();
    initializeRawSheets();
    renderRawSheet();
  }

  function renderOverview() {
    const { meta, firstSecond, leadStats, decks, leaders, aces, summary } = state.prepared;
    $('#overviewPeriod').textContent = meta.period;
    $('#overviewDescription').textContent = `${formatInt(meta.games)}試合・${formatInt(meta.users)}人のデータから、現在の傾向を整理。`;

    const kpis = [
      { label: '対象試合数', value: meta.games, unit: '試合', sub: `${formatInt(meta.logs)}件の提出ログ`, spark: 88 },
      { label: 'ユニークユーザー', value: meta.users, unit: '人', sub: '集計対象内', spark: 67 },
      { label: 'ユニークデッキ', value: meta.decks, unit: '種', sub: 'リーダー4体＋ACE', spark: 74 },
      { label: '最低掲載試合数', value: meta.minGames, unit: '試合', sub: 'ランキング条件', spark: 48 },
    ];
    $('#kpiGrid').innerHTML = kpis.map(item => `
      <article class="kpi-card">
        <span class="kpi-card__label">${escapeHtml(item.label)}</span>
        <strong class="kpi-card__value" data-counter="${item.value}">0<span class="kpi-card__unit">${escapeHtml(item.unit)}</span></strong>
        <span class="kpi-card__sub">${escapeHtml(item.sub)}</span>
        <i class="kpi-card__spark" style="--spark:${item.spark}%"></i>
      </article>
    `).join('');
    animateCounters();

    $('#firstSecondChart').innerHTML = firstSecond.map((row, index) => {
      const rate = number(row['勝率']);
      const color = index === 0 ? 'var(--accent)' : 'var(--blue)';
      return `
        <div class="rate-ring-card">
          <div class="rate-ring" style="--p:${(rate * 100).toFixed(2)};--ring-color:${color}"><strong>${percent(rate, 1)}</strong></div>
          <div><h4>${escapeHtml(row['先後'])}</h4><p>${formatInt(row['勝数'])}勝 / ${formatInt(row['試合数'])}試合</p></div>
        </div>`;
    }).join('');

    const leadTotalRows = leadStats.filter(row => row['先後'] === '合計');
    $('#leadChart').innerHTML = leadTotalRows.map((row, index) => {
      const rate = number(row['勝率']);
      const isWinLead = row['進行'] === '勝ち進行';
      return `
        <div class="lead-row">
          <div class="lead-row__label"><strong>${escapeHtml(row['進行'])}</strong><small>${formatInt(row['試合数'])}試合</small></div>
          <div class="rate-track"><div class="rate-track__fill" style="--value:${Math.max(rate * 100, 1)}%;--fill-start:${isWinLead ? 'var(--accent-deep)' : '#d24e6b'};--fill-end:${isWinLead ? 'var(--accent)' : 'var(--danger)'}"></div></div>
          <div class="lead-row__value">${percent(rate, 1)}</div>
        </div>
        <div class="lead-row">
          <div class="lead-row__label"><strong>構成比</strong><small>全試合内</small></div>
          <div class="rate-track"><div class="rate-track__fill" style="--value:${number(row['構成比']) * 100}%;--fill-start:#365c50;--fill-end:#698f82"></div></div>
          <div class="lead-row__value">${percent(row['構成比'], 1)}</div>
        </div>`;
    }).join('');

    $('#overviewDecks').innerHTML = decks.all.slice(0, 6).map(deck => `
      <button class="compact-deck" type="button" data-overview-deck="${deck.uid}">
        <span class="compact-deck__rank">#${deck.rank}</span>
        <span class="compact-deck__main"><strong>${escapeHtml(deck.leaders.join(' / '))}</strong><small>${escapeHtml(deck.aceText)}</small></span>
        <span class="compact-deck__rate"><strong>${percent(deck.winRate, 1)}</strong><small>${deck.games}試合</small></span>
      </button>
    `).join('');
    $$('#overviewDecks [data-overview-deck]').forEach(button => button.addEventListener('click', () => showDeckModal(findDeck(button.dataset.overviewDeck))));

    const makePickColumn = (title, list) => {
      const top = list.slice(0, 3);
      const max = Math.max(...top.map(item => item.adoptionRate), .01);
      return `<div class="pick-column"><h4>${title}</h4>${top.map(item => `
        <div class="pick-item"><span class="pick-item__name">${escapeHtml(item.name)}</span><span class="pick-item__value">${percent(item.adoptionRate, 1)}</span><div class="mini-track"><i style="--value:${item.adoptionRate / max * 100}%"></i></div></div>
      `).join('')}</div>`;
    };
    $('#overviewPicks').innerHTML = makePickColumn('Leader', leaders) + makePickColumn('ACE', aces);

    const noteKeys = ['記載方針', 'qualityScore定義', '進行の定義', 'RawLogsの色', '信頼下限'];
    $('#summaryNotes').innerHTML = noteKeys.filter(key => summary.has(key)).map(key => `
      <div class="note-item"><strong>${escapeHtml(key)}</strong><p>${escapeHtml(summary.get(key))}</p></div>
    `).join('');
  }

  function animateCounters() {
    $$('[data-counter]').forEach(element => {
      const target = number(element.dataset.counter);
      const unit = $('.kpi-card__unit', element)?.outerHTML || '';
      const start = performance.now();
      const duration = 760;
      const tick = now => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.innerHTML = `${formatInt(Math.round(target * eased))}${unit}`;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function initializeDeckControls() {
    $('#deckMinGames').value = state.prepared.meta.minGames;
  }

  function bindDeckEvents() {
    $('#deckSheetTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-deck-sheet]');
      if (!button) return;
      state.deckMode = button.dataset.deckSheet;
      state.deckLimit = 30;
      state.deckCompare.clear();
      $$('#deckSheetTabs button').forEach(item => item.classList.toggle('is-active', item === button));
      renderDecks();
    });
    ['deckSearch', 'deckMinGames', 'deckSort'].forEach(id => {
      $(`#${id}`).addEventListener(id === 'deckSort' ? 'change' : 'input', () => {
        state.deckLimit = 30;
        renderDecks();
      });
    });
    $('#loadMoreDecks').addEventListener('click', () => { state.deckLimit += 30; renderDecks(); });
    $('#clearCompare').addEventListener('click', () => { state.deckCompare.clear(); renderDecks(); });
    $('#deckList').addEventListener('click', event => {
      const button = event.target.closest('[data-deck-action]');
      if (!button) return;
      const deck = findDeck(button.dataset.deckId);
      if (!deck) return;
      if (button.dataset.deckAction === 'compare') toggleDeckCompare(deck);
      if (button.dataset.deckAction === 'similar') showSimilarModal(deck);
    });
    $('#compareChips').addEventListener('click', event => {
      if (event.target.closest('[data-open-comparison]')) showComparisonModal();
    });
  }

  function getFilteredDecks() {
    const search = normalizeText($('#deckSearch').value);
    const minGames = Math.max(0, number($('#deckMinGames').value));
    const sort = $('#deckSort').value;
    const list = [...state.prepared.decks[state.deckMode]]
      .filter(deck => deck.games >= minGames && (!search || deck.search.includes(search)));
    const sorters = {
      confidence: (a, b) => b.confidence - a.confidence || b.games - a.games,
      winrate: (a, b) => b.winRate - a.winRate || b.games - a.games,
      games: (a, b) => b.games - a.games || b.winRate - a.winRate,
      wins: (a, b) => b.wins - a.wins || b.games - a.games,
    };
    return list.sort(sorters[sort] || sorters.confidence);
  }

  function renderDecks() {
    const filtered = getFilteredDecks();
    const visible = filtered.slice(0, state.deckLimit);
    $('#deckResultCount').innerHTML = `<span>表示件数</span><strong>${formatInt(filtered.length)}</strong>`;
    $('#loadMoreDecks').hidden = visible.length >= filtered.length;

    $('#deckList').innerHTML = visible.length ? visible.map(deck => {
      const selected = state.deckCompare.has(deck.uid);
      return `
        <article class="deck-card ${selected ? 'is-selected' : ''}">
          <div class="deck-rank">#${deck.rank}</div>
          <div class="deck-main">
            <div class="deck-main__leaders">${deck.leaders.map(name => `<span class="tag">${escapeHtml(name)}</span>`).join('')}</div>
            <div class="deck-main__aces">${deck.aces.map(name => `<span class="tag tag--ace">${escapeHtml(name)}</span>`).join('')}</div>
          </div>
          <div class="deck-metrics">
            <div class="deck-metric"><span>試合</span><strong>${formatInt(deck.games)}</strong></div>
            <div class="deck-metric"><span>勝数</span><strong>${formatInt(deck.wins)}</strong></div>
            <div class="deck-metric deck-metric--accent"><span>勝率</span><strong>${percent(deck.winRate, 1)}</strong></div>
            <div class="deck-metric"><span>信頼下限</span><strong>${percent(deck.confidence, 1)}</strong></div>
          </div>
          <div class="deck-actions">
            <button type="button" data-deck-action="compare" data-deck-id="${deck.uid}">${selected ? '比較から外す' : '比較に追加'}</button>
            <button type="button" data-deck-action="similar" data-deck-id="${deck.uid}">似た構成</button>
          </div>
        </article>`;
    }).join('') : `<div class="empty-state"><div><strong>該当するデッキがない</strong>検索条件か最低試合数を調整してみて。</div></div>`;

    renderCompareBar();
  }

  function toggleDeckCompare(deck) {
    if (state.deckCompare.has(deck.uid)) state.deckCompare.delete(deck.uid);
    else {
      if (state.deckCompare.size >= 4) {
        showToast('比較できるのは最大4デッキまで。');
        return;
      }
      state.deckCompare.set(deck.uid, deck);
    }
    renderDecks();
  }

  function renderCompareBar() {
    const count = state.deckCompare.size;
    $('#compareBar').hidden = count === 0;
    $('#compareCount').textContent = count;
    $('#compareChips').innerHTML = [...state.deckCompare.values()].map(deck => `
      <span class="compare-chip">${escapeHtml(deck.leaders.join(' / '))}</span>
    `).join('') + (count >= 2 ? `<button class="secondary-button" type="button" data-open-comparison>比較表を開く</button>` : '');
  }

  function showDeckModal(deck) {
    if (!deck) return;
    const similar = getSimilarDecks(deck).slice(0, 5);
    openModal(`
      <p class="eyebrow">DECK DETAIL</p>
      <h2 id="modalTitle" class="modal-title">#${deck.rank} デッキ詳細</h2>
      <p class="modal-subtitle">${escapeHtml(deck.leaders.join(' / '))}<br>${escapeHtml(deck.aceText)}</p>
      <div class="deck-metrics">
        <div class="deck-metric"><span>試合数</span><strong>${formatInt(deck.games)}</strong></div>
        <div class="deck-metric"><span>勝数</span><strong>${formatInt(deck.wins)}</strong></div>
        <div class="deck-metric deck-metric--accent"><span>勝率</span><strong>${percent(deck.winRate, 1)}</strong></div>
        <div class="deck-metric"><span>信頼下限</span><strong>${percent(deck.confidence, 1)}</strong></div>
      </div>
      <h3 class="modal-section-title">近い構成</h3>
      ${renderSimilarList(similar)}
    `);
  }

  function showSimilarModal(deck) {
    const similar = getSimilarDecks(deck).slice(0, 12);
    openModal(`
      <p class="eyebrow">SIMILAR DECKS</p>
      <h2 id="modalTitle" class="modal-title">似た構成を比較</h2>
      <p class="modal-subtitle">基準: ${escapeHtml(deck.leaders.join(' / '))}<br>${escapeHtml(deck.aceText)}</p>
      ${renderSimilarList(similar)}
    `);
  }

  function getSimilarDecks(target) {
    return state.prepared.decks.all
      .filter(deck => deck.uid !== target.uid)
      .map(deck => {
        const leaderMatch = intersectionSize(target.leaders, deck.leaders) / Math.max(target.leaders.length, deck.leaders.length, 1);
        const aceMatch = intersectionSize(target.aces, deck.aces) / Math.max(target.aces.length, deck.aces.length, 1);
        const score = leaderMatch * .72 + aceMatch * .28;
        return { deck, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.deck.games - a.deck.games);
  }

  function renderSimilarList(items) {
    if (!items.length) return `<div class="empty-state"><div>近い構成は見つからなかった。</div></div>`;
    return `<div class="similar-list">${items.map(({ deck, score }) => `
      <div class="similar-item">
        <div class="similar-score">${Math.round(score * 100)}%</div>
        <div class="similar-item__deck"><strong>${escapeHtml(deck.leaders.join(' / '))}</strong><small>${escapeHtml(deck.aceText)}</small></div>
        <div class="similar-item__rate">勝率 ${percent(deck.winRate, 1)}<br><small>${deck.games}試合</small></div>
      </div>
    `).join('')}</div>`;
  }

  function showComparisonModal() {
    const decks = [...state.deckCompare.values()];
    if (decks.length < 2) return;
    const rows = [
      ['リーダー', deck => deck.leaders.join(' / ')],
      ['ACE', deck => deck.aceText],
      ['試合数', deck => formatInt(deck.games)],
      ['勝数', deck => formatInt(deck.wins)],
      ['勝率', deck => percent(deck.winRate, 1)],
      ['信頼下限', deck => percent(deck.confidence, 1)],
    ];
    openModal(`
      <p class="eyebrow">COMPARISON</p>
      <h2 id="modalTitle" class="modal-title">デッキ比較</h2>
      <p class="modal-subtitle">選択した${decks.length}デッキを横並びで確認。</p>
      <div class="comparison-grid" style="--compare-count:${decks.length}">
        <div class="comparison-cell comparison-cell--label">項目</div>
        ${decks.map((deck, i) => `<div class="comparison-cell comparison-cell--head">デッキ ${i + 1}</div>`).join('')}
        ${rows.map(([label, getter]) => `
          <div class="comparison-cell comparison-cell--label">${label}</div>
          ${decks.map(deck => `<div class="comparison-cell">${escapeHtml(getter(deck))}</div>`).join('')}
        `).join('')}
      </div>
    `);
  }

  function bindCardEvents() {
    $('#cardTypeTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-card-type]');
      if (!button) return;
      state.cardType = button.dataset.cardType;
      $$('#cardTypeTabs button').forEach(item => item.classList.toggle('is-active', item === button));
      renderCards();
    });
    $('#cardSearch').addEventListener('input', renderCards);
    $('#cardSort').addEventListener('change', renderCards);
  }

  function renderCards() {
    const source = state.cardType === 'leader' ? state.prepared.leaders : state.cardType === 'ace' ? state.prepared.aces : state.prepared.tactics;
    const query = normalizeText($('#cardSearch').value);
    const sort = $('#cardSort').value;
    const list = source.filter(item => !query || normalizeText(item.name).includes(query));
    const sorters = {
      adoption: (a, b) => b.adoptionRate - a.adoptionRate || b.count - a.count,
      winrate: (a, b) => b.winRate - a.winRate || b.games - a.games,
      games: (a, b) => b.games - a.games || b.winRate - a.winRate,
      count: (a, b) => b.count - a.count || b.adoptionRate - a.adoptionRate,
    };
    list.sort(sorters[sort] || sorters.adoption);
    const maxAdoption = Math.max(...list.map(item => item.adoptionRate), .01);
    $('#cardResultCount').innerHTML = `<span>表示件数</span><strong>${formatInt(list.length)}</strong>`;
    $('#cardStatsList').innerHTML = list.length ? list.map((item, index) => `
      <article class="stat-row">
        <div class="stat-row__name"><div class="stat-row__name-inner"><span class="stat-row__rank">${index + 1}</span><strong>${escapeHtml(item.name)}</strong></div></div>
        <div class="stat-row__bar">
          <div class="stat-row__bar-head"><span>${state.cardType === 'tactic' ? '使用率' : '採用率'}</span><strong>${percent(item.adoptionRate, 1)}</strong></div>
          <div class="rate-track"><div class="rate-track__fill" style="--value:${item.adoptionRate / maxAdoption * 100}%"></div></div>
        </div>
        <div class="stat-row__value"><span>${state.cardType === 'tactic' ? '使用数' : '採用数'}</span><strong>${formatInt(item.count)}</strong></div>
        <div class="stat-row__value"><span>試合数</span><strong>${formatInt(item.games)}</strong></div>
        <div class="stat-row__value stat-row__value--accent"><span>勝率</span><strong>${percent(item.winRate, 1)}</strong></div>
      </article>
    `).join('') : `<div class="empty-state"><div><strong>該当する項目がない</strong>検索語を変えてみて。</div></div>`;
  }

  function bindTacticEvents() {
    let timer;
    $('#tacticDeckSearch').addEventListener('input', event => {
      clearTimeout(timer);
      timer = setTimeout(() => selectTacticDeckByQuery(event.target.value), 250);
    });
    $('#tacticDeckSearch').addEventListener('change', event => selectTacticDeckByQuery(event.target.value, true));
    $('#showPopularTacticDeck').addEventListener('click', () => selectPopularTacticDeck());
  }

  function initializeTactics() {
    const decks = [...state.prepared.tacticGroups.keys()];
    $('#tacticDeckCount').innerHTML = `<span>デッキ数</span><strong>${formatInt(decks.length)}</strong>`;
    $('#tacticDeckOptions').innerHTML = decks.map(deck => `<option value="${escapeHtml(deck)}"></option>`).join('');
    selectPopularTacticDeck(false);
  }

  function selectPopularTacticDeck(showNotice = true) {
    const groups = [...state.prepared.tacticGroups.entries()];
    groups.sort((a, b) => sum(b[1].map(item => item.uses)) - sum(a[1].map(item => item.uses)));
    if (!groups.length) return;
    state.selectedTacticDeck = groups[0][0];
    $('#tacticDeckSearch').value = state.selectedTacticDeck;
    renderTacticDeck();
    if (showNotice) showToast('使用数が最も多いデッキを表示した。');
  }

  function selectTacticDeckByQuery(value, exact = false) {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const decks = [...state.prepared.tacticGroups.keys()];
    const matched = decks.find(deck => deck === value) || decks.find(deck => normalizeText(deck).includes(normalized));
    if (matched) {
      state.selectedTacticDeck = matched;
      if (exact) $('#tacticDeckSearch').value = matched;
      renderTacticDeck();
    }
  }

  function renderTacticDeck() {
    const deck = state.selectedTacticDeck;
    const rows = state.prepared.tacticGroups.get(deck) || [];
    const totalUses = sum(rows.map(item => item.uses));
    const [leaders = deck, aces = ''] = deck.split(' ＋ ');
    $('#tacticDeckSummary').innerHTML = `
      <div class="selected-deck__top">
        <div><p class="eyebrow">SELECTED DECK</p><h3>${escapeHtml(leaders)}</h3><p>${escapeHtml(aces)}</p></div>
        <div class="selected-deck__count">${formatInt(totalUses)}<small style="font-size:9px;color:var(--muted);display:block;text-align:right">使用</small></div>
      </div>`;
    $('#tacticSequenceList').innerHTML = rows.length ? rows.map((item, index) => {
      const steps = item.order.split(' → ').filter(Boolean);
      return `
        <article class="sequence-card">
          <div><p class="eyebrow">ORDER ${String(index + 1).padStart(2, '0')}</p><div class="sequence-flow">${steps.map((step, i) => `${i ? '<span class="sequence-arrow">→</span>' : ''}<span class="sequence-step">${escapeHtml(step)}</span>`).join('')}</div></div>
          <div class="sequence-metrics">
            <div class="sequence-metric"><span>使用数</span><strong>${formatInt(item.uses)}</strong></div>
            <div class="sequence-metric"><span>使用率</span><strong>${percent(item.useRate, 1)}</strong></div>
            <div class="sequence-metric sequence-metric--accent"><span>勝率</span><strong>${percent(item.winRate, 1)}</strong></div>
          </div>
        </article>`;
    }).join('') : `<div class="empty-state"><div>このデッキのタクティクスデータがない。</div></div>`;
  }

  function bindLogEvents() {
    ['logSearch', 'logTurnFilter', 'logResultFilter', 'logLeadFilter'].forEach(id => {
      $(`#${id}`).addEventListener(id === 'logSearch' ? 'input' : 'change', () => { state.logPage = 1; renderLogs(); });
    });
  }

  function getFilteredLogs() {
    const query = normalizeText($('#logSearch').value);
    const turn = $('#logTurnFilter').value;
    const result = $('#logResultFilter').value;
    const lead = $('#logLeadFilter').value;
    return state.prepared.logs.filter(log => {
      if (turn && log['先後'] !== turn) return false;
      if (result && log['結果'] !== result) return false;
      if (lead && log['進行'] !== lead) return false;
      if (query) {
        const haystack = normalizeText(Object.values(log).filter(value => value != null).join(' '));
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function renderLogs() {
    const logs = getFilteredLogs();
    const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE_LOGS));
    state.logPage = Math.min(state.logPage, totalPages);
    const pageRows = logs.slice((state.logPage - 1) * PAGE_SIZE_LOGS, state.logPage * PAGE_SIZE_LOGS);
    const headers = state.prepared.rawHeaders;
    $('#logResultCount').innerHTML = `<span>該当ログ</span><strong>${formatInt(logs.length)}</strong>`;

    $('#logTableWrap').innerHTML = `
      <table class="data-table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${pageRows.map(log => `<tr>${headers.map(header => {
        const value = displayLogValue(header, log[header]);
        const cls = header === '結果' && log[header] === '勝' ? 'cell-win' : header === '結果' && log[header] === '負' ? 'cell-loss' : '';
        return `<td class="${cls}" title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;

    $('#logMobileCards').innerHTML = pageRows.map(log => `
      <article class="log-card">
        <div class="log-card__top"><strong>${escapeHtml(log['大会名'] || '名称なし')}</strong><span class="${log['結果'] === '勝' ? 'is-win' : 'is-loss'}">${escapeHtml(log['結果'] || '—')}</span></div>
        <div class="log-card__meta"><span>${formatExcelDate(log['大会日付'])}</span><span>${escapeHtml(log['ユーザー名'] || '—')}</span><span>${escapeHtml(log['先後'] || '—')}</span><span>${escapeHtml(log['進行'] || '—')}</span></div>
        <details><summary>全25項目を表示</summary><div class="log-detail-grid">${headers.map(header => `<div class="log-detail"><span>${escapeHtml(header)}</span><strong>${escapeHtml(displayLogValue(header, log[header]))}</strong></div>`).join('')}</div></details>
      </article>`).join('');

    renderPagination($('#logPagination'), state.logPage, totalPages, page => { state.logPage = page; renderLogs(); scrollViewTop(); });
  }

  function bindRawEvents() {
    $('#rawSheetSelect').addEventListener('change', event => { state.rawSheet = event.target.value; state.rawPage = 1; renderRawSheet(); });
    $('#rawSearch').addEventListener('input', () => { state.rawPage = 1; renderRawSheet(); });
  }

  function initializeRawSheets() {
    const order = state.data.sheetOrder || Object.keys(state.data.sheets);
    $('#rawSheetSelect').innerHTML = order.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    $('#rawSheetSelect').value = state.rawSheet;
  }

  function renderRawSheet() {
    const rows = getSheetRows(state.data, state.rawSheet);
    const query = normalizeText($('#rawSearch').value);
    const filtered = rows.map((row, index) => ({ row, index })).filter(item => !query || normalizeText(item.row.join(' ')).includes(query));
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE_RAW));
    state.rawPage = Math.min(state.rawPage, totalPages);
    const pageRows = filtered.slice((state.rawPage - 1) * PAGE_SIZE_RAW, state.rawPage * PAGE_SIZE_RAW);
    const colCount = Math.max(1, ...rows.map(row => row.length));
    $('#rawSheetSize').innerHTML = `<span>サイズ</span><strong>${formatInt(rows.length)}×${formatInt(colCount)}</strong>`;

    const columns = Array.from({ length: colCount }, (_, i) => columnLetter(i));
    $('#rawTableWrap').innerHTML = `
      <table class="data-table"><thead><tr><th>#</th>${columns.map(col => `<th>${col}</th>`).join('')}</tr></thead>
      <tbody>${pageRows.map(({ row, index }) => `<tr><td>${index + 1}</td>${columns.map((_, colIndex) => {
        const display = displayRawValue(state.rawSheet, index, colIndex, row[colIndex]);
        return `<td class="${display === '—' ? 'raw-cell-empty' : ''}" title="${escapeHtml(display)}">${escapeHtml(display)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
    renderPagination($('#rawPagination'), state.rawPage, totalPages, page => { state.rawPage = page; renderRawSheet(); });
  }

  function switchView(view, updateHash = true) {
    state.activeView = view;
    $$('[data-view-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.viewPanel === view));
    $$('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === view));
    elements.sidebar.classList.remove('is-open');
    if (updateHash) history.replaceState(null, '', `#${view}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function lockApp() {
    sessionStorage.removeItem(SESSION_KEY);
    state.data = null;
    state.prepared = null;
    elements.app.hidden = true;
    elements.authScreen.hidden = false;
    elements.passwordInput.value = '';
    setAuthMessage('ロックした。');
    elements.passwordInput.focus();
  }

  async function handleLocalWorkbook(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    showToast('Excelを読み込んでいる…');
    try {
      await loadSheetJs();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellFormula: true });
      const sheets = {};
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
        const range = sheet['!ref'] || 'A1:A1';
        sheets[name] = { range, rows };
      }
      const payload = {
        format: 'xross-stats-data', version: 1, generatedAt: new Date().toISOString(), sourceFile: file.name,
        sheetOrder: workbook.SheetNames, sheets,
      };
      validatePayload(payload);
      loadData(payload, 'workbook');
      showToast(`${file.name}を一時的に反映した。再読込すると元に戻る。`);
    } catch (error) {
      console.error(error);
      showToast('Excelを読み込めなかった。シート名やファイル形式を確認してね。');
    }
  }

  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('SheetJS load failed'));
      document.head.appendChild(script);
    });
  }

  function renderPagination(container, current, total, onChange) {
    if (total <= 1) { container.innerHTML = ''; return; }
    const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
    const valid = [...pages].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
    let last = 0;
    const html = [`<button type="button" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>‹</button>`];
    for (const page of valid) {
      if (page - last > 1) html.push('<span style="color:var(--muted-2);font-size:9px">…</span>');
      html.push(`<button type="button" class="${page === current ? 'is-active' : ''}" data-page="${page}">${page}</button>`);
      last = page;
    }
    html.push(`<button type="button" data-page="${current + 1}" ${current === total ? 'disabled' : ''}>›</button>`);
    container.innerHTML = html.join('');
    container.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
      const page = number(button.dataset.page);
      if (page >= 1 && page <= total && page !== current) onChange(page);
    }));
  }

  function openModal(html) {
    elements.modalContent.innerHTML = html;
    elements.modal.hidden = false;
    document.body.classList.add('is-modal-open');
  }

  function closeModal() {
    elements.modal.hidden = true;
    elements.modalContent.innerHTML = '';
    document.body.classList.remove('is-modal-open');
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    state.toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3200);
  }

  function setAuthMessage(message, success = false) {
    elements.authMessage.textContent = message;
    elements.authMessage.classList.toggle('is-success', success);
  }

  function setUnlockLoading(loading) {
    elements.unlockButton.disabled = loading;
    elements.unlockButton.classList.toggle('is-loading', loading);
  }

  function findDeck(uid) {
    for (const list of Object.values(state.prepared?.decks || {})) {
      const found = list.find(deck => deck.uid === uid);
      if (found) return found;
    }
    return null;
  }

  function displayLogValue(header, value) {
    if (header === '大会日付') return formatExcelDate(value);
    return displayValue(value);
  }

  function displayRawValue(sheetName, rowIndex, colIndex, value) {
    if (value == null || value === '') return '—';
    if (sheetName === 'RawLogs' && rowIndex >= 2 && colIndex === 0) return formatExcelDate(value);
    if (sheetName === 'Summary' && colIndex === 1) {
      const key = getSheetRows(state.data, 'Summary')[rowIndex]?.[0];
      if (String(key || '').includes('日') || key === '最終更新') {
        if (typeof value === 'number') return key === '最終更新' ? formatDateTime(value) : formatExcelDate(value);
      }
    }
    if (typeof value === 'number') return Number.isInteger(value) ? formatInt(value) : trimNumber(value);
    return String(value);
  }

  function displayValue(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'number') return Number.isInteger(value) ? formatInt(value) : trimNumber(value);
    return String(value);
  }

  function formatExcelDate(value) {
    if (value == null || value === '') return '—';
    if (value instanceof Date) return formatDateObject(value);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDateObject(new Date(value));
    const serial = number(value);
    if (!serial) return String(value);
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return formatDateObject(date);
  }

  function formatDateTime(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
      return value;
    }
    const serial = number(value);
    if (!serial) return String(value);
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function formatDateObject(date) {
    return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function percent(value, digits = 1) {
    const n = number(value);
    return `${(n * 100).toFixed(digits)}%`;
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function formatInt(value) {
    return new Intl.NumberFormat('ja-JP').format(number(value));
  }

  function trimNumber(value) {
    return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 4 }).format(value);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function intersectionSize(a, b) {
    const setB = new Set(b);
    return new Set(a.filter(item => setB.has(item))).size;
  }

  function sum(values) { return values.reduce((total, value) => total + number(value), 0); }

  function columnLetter(index) {
    let n = index + 1;
    let result = '';
    while (n > 0) {
      n--;
      result = String.fromCharCode(65 + n % 26) + result;
      n = Math.floor(n / 26);
    }
    return result;
  }

  function scrollViewTop() {
    elements.mainContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
