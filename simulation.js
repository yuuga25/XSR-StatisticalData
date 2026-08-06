/**
 * 収穫アサルト シミュレーション（累計1,000,000回）のビュー。
 * index.html の data-view-panel="simulation" の中に描画する。
 *
 * データは sim.enc。統計の data.enc と同じ方式（PBKDF2-SHA256 35万回 + AES-256-GCM）で
 * 暗号化してあり、解錠時のパスワードで復号する。平文はリポジトリに置かない。
 * ID は統計側のビューと衝突しないよう sim 接頭辞を付ける。
 */
(() => {
  'use strict';

  const DATA_URL = 'sim.enc';
  const MAGIC = 'XSD1';
  const AAD_TEXT = 'Xross Stats Dashboard v1';
  const PBKDF2_ITERATIONS = 350000;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const int = v => new Intl.NumberFormat('ja-JP').format(Number(v) || 0);
  const pct = (v, d = 1) => v == null ? '—' : `${(Number(v) * 100).toFixed(d)}%`;
  const dec = (v, d = 2) => v == null ? '—' : Number(v).toFixed(d);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const pt = v => `${v >= 0 ? '+' : ''}${(Number(v) * 100).toFixed(2)}pt`;

  let D = null;
  const condKey = r => `${r.matchup_id}|${r.position}|${r.player_tactic}|${r.opponent_tactic}`;
  const condLabel = r => `${r.matchup_name} / ${r.position} / 自${r.player_tactic} × 相${r.opponent_tactic}`;

  /** 勝率50%を中心に発散するバー。右へ伸びるほど有利。 */
  const winBar = rate => {
    const v = Math.min(Math.max(Number(rate) || 0, 0), 1);
    const tone = v >= .55 ? 'is-good' : v <= .45 ? 'is-bad' : 'is-even';
    return `<div class="mu-bar ${tone}"><i style="left:${(Math.min(v, .5) * 100).toFixed(2)}%;width:${Math.max(Math.abs(v - .5) * 100, .8).toFixed(2)}%"></i></div>`;
  };
  /** 0起点の割合バー（分布・構成比用） */
  const shareBar = (rate, max = 1) =>
    `<div class="sim-bar"><i style="width:${Math.max((Number(rate) || 0) / max * 100, .6).toFixed(2)}%"></i></div>`;
  /** 95%信頼区間 */
  const ciBar = (low, high, point) => `<div class="sim-ci" title="95%信頼区間 ${pct(low, 2)} 〜 ${pct(high, 2)}">
      <i class="sim-ci__range" style="left:${(low * 100).toFixed(2)}%;width:${Math.max((high - low) * 100, .4).toFixed(2)}%"></i>
      <i class="sim-ci__point" style="left:${(point * 100).toFixed(2)}%"></i>
      <b class="sim-ci__mid"></b>
    </div>`;

  const table = (rows, cols) => {
    if (!rows.length) return '<div class="empty-state">この条件では記録なし。</div>';
    return `<table class="sim-table"><thead><tr>${cols.map(c =>
      `<th class="${c.numeric ? 'is-num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => {
        const v = c.get ? c.get(r) : r[c.field];
        return `<td class="${c.numeric ? 'is-num' : ''}">${c.raw ? v : esc(v ?? '—')}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  };

  const BASE_COLS = [
    { label: 'matchup_id', field: 'matchup_id' },
    { label: '対面', field: 'matchup_name' },
    { label: '先後', field: 'position' },
    { label: '自タクティクス', field: 'player_tactic' },
    { label: '相手タクティクス', field: 'opponent_tactic' }
  ];

  // ---- 概要 -----------------------------------------------------------------
  function paneOverview() {
    const m = D.meta;
    const best = [...D.condition].sort((a, b) => b.total_win_rate - a.total_win_rate)[0];
    const worst = [...D.condition].sort((a, b) => a.total_win_rate - b.total_win_rate)[0];
    const kpis = [
      { label: '累計ラウンド', value: int(m.rounds), sub: `前回 ${int(m.previousRounds)} + 追加 ${int(m.addedRounds)}` },
      { label: '条件数', value: m.conditions, sub: `1条件あたり ${m.roundsPerCondition}回` },
      { label: '最高勝率', value: pct(best.total_win_rate), sub: `${best.matchup_name} / ${best.position}` },
      { label: '最低勝率', value: pct(worst.total_win_rate), sub: `${worst.matchup_name} / ${worst.position}` }
    ];
    const defs = [
      ['対象', m.scope], ['前回累計', `${int(m.previousRounds)}回`], ['今回追加', `${int(m.addedRounds)}回`],
      ['新しい累計', `${int(m.rounds)}回`], ['条件数', `${m.conditions}`],
      ['各条件の累計', `${m.roundsPerCondition}回`], ['追加回数の範囲', `${m.addedPerCondition}回`],
      ['追加バッチファイル', `${m.batchFiles}`], ['ベースseed', `${m.baseSeed}`],
      ['追加index範囲', m.indexRange], ['後攻ペア比較', m.pairNote], ['再現キー', m.reproKeys],
      ['自動テスト', `${m.testsPassed}件合格`],
      ['異常 / 未決着', `${D.validation.anomalies} / ${D.validation.unresolved}`],
      ['モデルの前提', m.modelNote]
    ];
    const groups = new Map();
    D.condition.forEach(r => {
      const g = groups.get(r.matchup_name) || { name: r.matchup_name, rounds: 0, wins: 0, count: 0 };
      g.rounds += r.total_rounds; g.wins += r.wins; g.count += 1;
      groups.set(r.matchup_name, g);
    });
    const matchups = [...groups.values()].map(g => ({ ...g, rate: g.rounds ? g.wins / g.rounds : 0 }))
      .sort((a, b) => b.rate - a.rate);

    return `
      <div class="kpi-grid">${kpis.map((k, i) => `
        <article class="kpi-card">
          <div class="kpi-card__index"><span>0${i + 1}</span><span>${esc(k.label)}</span></div>
          <strong class="kpi-card__value">${esc(k.value)}</strong>
          <span class="kpi-card__sub">${esc(k.sub)}</span>
        </article>`).join('')}</div>
      <div class="layout-two">
        <article class="panel">
          <div class="panel__head"><div><p class="kicker">RUN CONDITIONS</p><h3>実行条件</h3></div></div>
          <div class="sim-defs">${defs.map(([k, v]) => `<div class="sim-def"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>
        </article>
        <article class="panel">
          <div class="panel__head"><div><p class="kicker">MATCHUPS</p><h3>対面別の到達点</h3></div><span class="panel__meta">TOTAL WIN RATE</span></div>
          <div class="sim-matchups">${matchups.map(g => `
            <div class="sim-matchup">
              <div class="sim-matchup__head"><b>${esc(g.name)}</b><span>${pct(g.rate)}</span></div>
              ${winBar(g.rate)}
              <small>${g.count}条件 / ${int(g.rounds)}ラウンド / ${int(g.wins)}勝</small>
            </div>`).join('')}</div>
        </article>
      </div>`;
  }

  // ---- 条件比較 -------------------------------------------------------------
  const COND_COLS = [
    ...BASE_COLS,
    { label: '前回ラウンド', numeric: true, get: r => int(r.previous_rounds) },
    { label: '前回勝率', numeric: true, get: r => pct(r.previous_win_rate, 2) },
    { label: '追加ラウンド', numeric: true, get: r => int(r.added_rounds) },
    { label: '追加勝率', numeric: true, get: r => pct(r.added_win_rate, 2) },
    { label: '差（追加−前回）', numeric: true, get: r => pt(r.delta_added_minus_previous) },
    { label: '総ラウンド', numeric: true, get: r => int(r.total_rounds) },
    { label: '勝', numeric: true, get: r => int(r.wins) },
    { label: '負', numeric: true, get: r => int(r.losses) },
    { label: '両者敗北', numeric: true, get: r => int(r.both_loss) },
    { label: '総合勝率', numeric: true, get: r => pct(r.total_win_rate, 2) },
    { label: 'CI95下限', numeric: true, get: r => pct(r.ci95_low, 2) },
    { label: 'CI95上限', numeric: true, get: r => pct(r.ci95_high, 2) },
    { label: '平均ハーフターン', numeric: true, get: r => dec(r.mean_half_turns, 3) },
    { label: '自分の平均ターン', numeric: true, get: r => dec(r.mean_player_turns, 3) },
    { label: '相手の平均ターン', numeric: true, get: r => dec(r.mean_opponent_turns, 3) },
    { label: 'PPチケット使用率', numeric: true, get: r => pct(r.pp_ticket_use_rate, 2) }
  ];

  function paneConditions() {
    return `
      <div class="control-bar">
        <label class="search-control search-control--wide"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="simCondSearch" type="search" placeholder="対面・タクティクスで絞り込み"></label>
        <label class="select-control"><span>並び順</span><select id="simCondSort">
          <option value="winrate">総合勝率</option>
          <option value="delta">追加分との差</option>
          <option value="turns">平均ハーフターン</option>
          <option value="pp">PPチケット使用率</option>
          <option value="name">対面名</option>
        </select></label>
      </div>
      <div id="simCondList" class="sim-cond-list"></div>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">01_condition_comparison</p><h3>全21列</h3></div><span class="panel__meta">29 ROWS</span></div>
        <div id="simCondTable" class="sim-table-wrap"></div>
      </article>`;
  }

  function renderConditions() {
    const q = ($('#simCondSearch')?.value || '').trim().toLowerCase();
    const sort = $('#simCondSort')?.value || 'winrate';
    const sorters = {
      winrate: (a, b) => b.total_win_rate - a.total_win_rate,
      delta: (a, b) => Math.abs(b.delta_added_minus_previous) - Math.abs(a.delta_added_minus_previous),
      turns: (a, b) => a.mean_half_turns - b.mean_half_turns,
      pp: (a, b) => b.pp_ticket_use_rate - a.pp_ticket_use_rate,
      name: (a, b) => a.matchup_name.localeCompare(b.matchup_name, 'ja') || a.position.localeCompare(b.position, 'ja')
    };
    const rows = D.condition
      .filter(r => !q || condLabel(r).toLowerCase().includes(q) || r.matchup_id.includes(q))
      .sort(sorters[sort] || sorters.winrate);

    $('#simCondList').innerHTML = rows.length ? rows.map(r => `
      <article class="sim-cond">
        <div class="sim-cond__id">
          <b>${esc(r.matchup_name)}</b>
          <span>${esc(r.position)} ・ 自 ${esc(r.player_tactic)} × 相 ${esc(r.opponent_tactic)}</span>
          <small>${esc(r.matchup_id)}</small>
        </div>
        <div class="sim-cond__rate">
          <strong>${pct(r.total_win_rate)}</strong>
          <span>${int(r.wins)}勝 / ${int(r.total_rounds)}</span>
        </div>
        <div class="sim-cond__bars">
          ${winBar(r.total_win_rate)}
          ${ciBar(r.ci95_low, r.ci95_high, r.total_win_rate)}
          <small>95%信頼区間 ${pct(r.ci95_low, 2)} 〜 ${pct(r.ci95_high, 2)}</small>
        </div>
        <div class="sim-cond__stats">
          <div><span>前回</span><b>${pct(r.previous_win_rate)}</b></div>
          <div><span>追加</span><b>${pct(r.added_win_rate)}</b></div>
          <div><span>差</span><b class="${r.delta_added_minus_previous >= 0 ? 'is-up' : 'is-down'}">${pt(r.delta_added_minus_previous)}</b></div>
          <div><span>平均HT</span><b>${dec(r.mean_half_turns, 2)}</b></div>
          <div><span>PP使用</span><b>${pct(r.pp_ticket_use_rate)}</b></div>
        </div>
      </article>`).join('') : '<div class="empty-state"><strong>該当する条件がない</strong>検索語を変えて。</div>';

    $('#simCondTable').innerHTML = table(rows, COND_COLS);
  }

  // ---- 後攻ペア比較 ---------------------------------------------------------
  function panePaired() {
    const cards = D.paired.map(r => {
      const total = r.paired_rounds || 1;
      const seg = [
        ['both_win', '両方勝ち', r.both_win],
        ['adr', 'アドレナリンのみ', r.adrenaline_only_win],
        ['cyb', 'サイバネのみ', r.cyber_only_win],
        ['both_loss', '両方負け', r.both_loss]
      ];
      const d = r.delta_cyber_minus_adrenaline;
      return `<article class="sim-pair">
        <div class="sim-pair__head">
          <div><b>${esc(r.matchup_name)}</b><span>相手 ${esc(r.opponent_tactic)} ・ ${int(r.paired_rounds)}ペア</span></div>
          <div class="sim-pair__delta ${d >= 0 ? 'is-up' : 'is-down'}">
            <span>サイバネ − アドレナリン</span><strong>${pt(d)}</strong>
          </div>
        </div>
        <div class="sim-pair__vs">
          <div><span>アドレナリン</span><strong>${pct(r.adrenaline_win_rate)}</strong><small>${int(r.adrenaline_wins)}勝</small>${winBar(r.adrenaline_win_rate)}</div>
          <div><span>サイバネアーマー</span><strong>${pct(r.cyber_win_rate)}</strong><small>${int(r.cyber_wins)}勝</small>${winBar(r.cyber_win_rate)}</div>
        </div>
        <div class="sim-pair__stack" role="img" aria-label="同一seedでの勝敗の重なり">
          ${seg.map(([c, name, v]) => `<i class="is-${c}" style="flex:${v || 0}" title="${name} ${int(v)}"></i>`).join('')}
        </div>
        <div class="sim-pair__legend">
          ${seg.map(([c, name, v]) => `<span class="is-${c}"><b>${esc(name)}</b>${int(v)}<i>${pct((v || 0) / total)}</i></span>`).join('')}
        </div>
      </article>`;
    }).join('');

    return `<div class="sim-paired-list">${cards}</div>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">02_paired_tactic_comparison</p><h3>全13列</h3></div><span class="panel__meta">${D.paired.length} ROWS</span></div>
        <div id="simPairedTable" class="sim-table-wrap"></div>
      </article>`;
  }

  function renderPaired() {
    $('#simPairedTable').innerHTML = table(D.paired, [
      { label: 'matchup_id', field: 'matchup_id' },
      { label: '対面', field: 'matchup_name' },
      { label: '相手タクティクス', field: 'opponent_tactic' },
      { label: 'ペア数', numeric: true, get: r => int(r.paired_rounds) },
      { label: 'アドレ勝数', numeric: true, get: r => int(r.adrenaline_wins) },
      { label: 'サイバネ勝数', numeric: true, get: r => int(r.cyber_wins) },
      { label: 'アドレ勝率', numeric: true, get: r => pct(r.adrenaline_win_rate, 2) },
      { label: 'サイバネ勝率', numeric: true, get: r => pct(r.cyber_win_rate, 2) },
      { label: '差', numeric: true, get: r => pt(r.delta_cyber_minus_adrenaline) },
      { label: '両方勝ち', numeric: true, get: r => int(r.both_win) },
      { label: 'アドレのみ', numeric: true, get: r => int(r.adrenaline_only_win) },
      { label: 'サイバネのみ', numeric: true, get: r => int(r.cyber_only_win) },
      { label: '両方負け', numeric: true, get: r => int(r.both_loss) }
    ]);
  }

  // ---- 条件詳細 -------------------------------------------------------------
  let selected = '';

  function paneDetail() {
    return `
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">SELECT</p><h3>条件を選ぶ</h3></div><span class="panel__meta">29 CONDITIONS</span></div>
        <div id="simPicker" class="sim-picker"></div>
      </article>
      <div id="simDetail"></div>`;
  }

  function renderPicker() {
    $('#simPicker').innerHTML = D.condition.map(r => `
      <button class="sim-chip ${condKey(r) === selected ? 'is-active' : ''}" type="button" data-sim-cond="${esc(condKey(r))}">
        <b>${esc(r.matchup_name)}</b>
        <span>${esc(r.position)} / 自${esc(r.player_tactic)}</span>
        <small>相${esc(r.opponent_tactic)} ・ ${pct(r.total_win_rate)}</small>
      </button>`).join('');
  }

  const distPanel = (title, meta, rows, cols, rateField, labelField, note = '') => {
    const max = Math.max(...rows.map(r => r[rateField] || 0), 0.0001);
    return `<article class="panel">
      <div class="panel__head"><div><p class="kicker">${esc(meta)}</p><h3>${esc(title)}</h3></div><span class="panel__meta">${rows.length} 行</span></div>
      ${note ? `<p class="panel__note">${esc(note)}</p>` : ''}
      <div class="sim-dist">${rows.length ? rows.map(r => `
        <div class="sim-dist__row">
          <div class="sim-dist__label">${esc(r[labelField])}</div>
          ${shareBar(r[rateField], max)}
          <div class="sim-dist__value"><b>${pct(r[rateField], 2)}</b><small>${int(r.count)}</small></div>
        </div>`).join('') : '<div class="empty-state">この条件では記録なし。</div>'}</div>
      <div class="sim-table-wrap">${table(rows, cols)}</div>
    </article>`;
  };

  function renderDetail() {
    const c = D.condition.find(r => condKey(r) === selected);
    if (!c) return;
    const pick = list => list.filter(r => condKey(r) === selected);
    const ft = pick(D.finishTurn).sort((a, b) => a.half_turns - b.half_turns);
    const cb = pick(D.combo).sort((a, b) => b.rate - a.rate);
    const lc = pick(D.lethalCard).sort((a, b) => b.share_of_player_wins - a.share_of_player_wins);
    const hp = pick(D.lethalHp).sort((a, b) => a.rank - b.rank);
    const pp = pick(D.ppTicket).sort((a, b) => a.use_turn - b.use_turn);
    const ad = pick(D.adrenaline)[0];

    const head = `<article class="panel">
      <div class="panel__head"><div><p class="kicker">SELECTED</p><h3>${esc(c.matchup_name)}</h3></div><span class="panel__meta">${esc(c.matchup_id)}</span></div>
      <div class="sim-detail-grid">
        <div><span>先後</span><b>${esc(c.position)}</b></div>
        <div><span>自タクティクス</span><b>${esc(c.player_tactic)}</b></div>
        <div><span>相手タクティクス</span><b>${esc(c.opponent_tactic)}</b></div>
        <div><span>総合勝率</span><b>${pct(c.total_win_rate)}</b></div>
        <div><span>95%信頼区間</span><b>${pct(c.ci95_low, 2)} 〜 ${pct(c.ci95_high, 2)}</b></div>
        <div><span>総ラウンド</span><b>${int(c.total_rounds)}</b></div>
        <div><span>勝 / 負</span><b>${int(c.wins)} / ${int(c.losses)}</b></div>
        <div><span>両者敗北</span><b>${int(c.both_loss)}</b></div>
        <div><span>前回勝率</span><b>${pct(c.previous_win_rate)}</b></div>
        <div><span>追加勝率</span><b>${pct(c.added_win_rate)}</b></div>
        <div><span>差（追加−前回）</span><b>${pt(c.delta_added_minus_previous)}</b></div>
        <div><span>平均ハーフターン</span><b>${dec(c.mean_half_turns, 3)}</b></div>
        <div><span>自分の平均ターン</span><b>${dec(c.mean_player_turns, 3)}</b></div>
        <div><span>相手の平均ターン</span><b>${dec(c.mean_opponent_turns, 3)}</b></div>
        <div><span>PPチケット使用率</span><b>${pct(c.pp_ticket_use_rate, 2)}</b></div>
      </div>
    </article>`;

    const adPanel = ad ? `<article class="panel">
      <div class="panel__head"><div><p class="kicker">08_adrenaline_draw_summary</p><h3>アドレナリンのドロー依存</h3></div></div>
      <div class="sim-detail-grid">
        <div><span>ラウンド</span><b>${int(ad.rounds)}</b></div>
        <div><span>ドロー依存の使用</span><b>${int(ad.draw_dependent_uses)}</b></div>
        <div><span>直接ドローで撃破</span><b>${int(ad.direct_draw_card_downs)}</b></div>
        <div><span>同一ターン撃破</span><b>${int(ad.same_turn_downs)}</b></div>
        <div><span>直接成功率</span><b>${pct(ad.direct_success_rate, 2)}</b></div>
        <div><span>同一ターン成功率</span><b>${pct(ad.same_turn_success_rate, 2)}</b></div>
      </div>
      ${ad.draw_dependent_uses ? '' : '<p class="panel__note">この条件は自タクティクスがアドレナリンではないため、探索の記録がない。</p>'}
    </article>` : '';

    $('#simDetail').innerHTML = head
      + distPanel('決着ハーフターン分布', '03_finish_turn_distribution', ft,
          [...BASE_COLS, { label: 'ハーフターン', numeric: true, field: 'half_turns' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '比率', numeric: true, get: r => pct(r.rate, 3) }], 'rate', 'half_turns',
          `ハーフターン＝先後合わせた手番数。平均 ${dec(c.mean_half_turns, 3)}。`)
      + distPanel('コンボ成立分布', '04_combo_distribution', cb,
          [...BASE_COLS, { label: 'コンボ', field: 'combo_class' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '比率', numeric: true, get: r => pct(r.rate, 3) }], 'rate', 'combo_class')
      + distPanel('最終リーサルカード', '05_lethal_card_distribution', lc,
          [...BASE_COLS, { label: 'カード', field: 'lethal_card' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '自分の勝ちに占める比率', numeric: true, get: r => pct(r.share_of_player_wins, 3) }],
          'share_of_player_wins', 'lethal_card')
      + `<article class="panel">
          <div class="panel__head"><div><p class="kicker">06_lethal_hp_top_patterns</p><h3>リーサルターン開始時のHPパターン</h3></div><span class="panel__meta">${hp.length} 行</span></div>
          <div class="sim-table-wrap">${table(hp, [...BASE_COLS,
            { label: '順位', numeric: true, field: 'rank' },
            { label: 'HPベクトル', field: 'hp_vector' },
            { label: '昇順HP', field: 'sorted_hp_vector' },
            { label: '生存数', numeric: true, field: 'alive_count' },
            { label: '合計HP', numeric: true, get: r => int(r.total_hp) },
            { label: '件数', numeric: true, get: r => int(r.count) },
            { label: '自分の勝ちに占める比率', numeric: true, get: r => pct(r.share_of_player_wins, 3) }])}</div>
        </article>`
      + distPanel('PPチケット使用ターン', '07_pp_ticket_turns', pp,
          [...BASE_COLS, { label: '使用ターン', numeric: true, field: 'use_turn' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '使用に占める比率', numeric: true, get: r => pct(r.share_of_uses, 3) }],
          'share_of_uses', 'use_turn', `この条件の使用率は ${pct(c.pp_ticket_use_rate, 2)}。`)
      + adPanel;
  }

  // ---- 検証 -----------------------------------------------------------------
  function paneIntegrity() {
    const kv = obj => Object.entries(obj)
      .filter(([, v]) => typeof v !== 'object' || v === null)
      .map(([k, v]) => `<div class="sim-def"><b>${esc(k)}</b><span>${esc(typeof v === 'boolean' ? (v ? 'OK' : 'NG') : v)}</span></div>`).join('');
    const badge = ok => `<span class="sim-badge ${ok ? 'is-ok' : 'is-ng'}">${ok ? 'OK' : 'NG'}</span>`;

    return `
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">validation_report</p><h3>検証レポート ${badge(D.validation.ok)}</h3></div></div>
        <div class="sim-defs">${kv(D.validation)}
          <div class="sim-def"><b>duplicate_condition_seeds</b><span>previous745k: ${D.validation.duplicate_condition_seeds.previous745k} / added255k: ${D.validation.duplicate_condition_seeds.added255k}</span></div>
        </div>
      </article>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">execution_integrity</p><h3>実行整合 ${badge(D.execution.ok)}</h3></div></div>
        <div class="sim-defs">${kv(D.execution)}</div>
      </article>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">batch_integrity</p><h3>バッチ整合 ${badge(D.batch.ok)}</h3></div></div>
        <div class="sim-defs">${kv(D.batch)}</div>
      </article>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">allocation</p><h3>条件ごとの割り当て ${badge(D.allocation.ok)}</h3></div><span class="panel__meta">${(D.allocation.condition_ranges || []).length} 条件</span></div>
        <div class="sim-defs">${kv(D.allocation)}</div>
        <div class="sim-table-wrap">${table(D.allocation.condition_ranges || [], [
          { label: 'matchup_id', field: 'matchup_id' },
          { label: '先後', field: 'player_position' },
          { label: '自タクティクス', field: 'player_tactic' },
          { label: '相手タクティクス', field: 'opponent_tactic' },
          { label: '前回', numeric: true, get: r => int(r.previous_rounds) },
          { label: '追加', numeric: true, get: r => int(r.additional_rounds) },
          { label: 'index開始', numeric: true, get: r => int(r.index_start) },
          { label: 'index終了', numeric: true, get: r => int(r.index_end) }
        ])}</div>
      </article>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">sha256_manifest_final</p><h3>チェックサム</h3></div><span class="panel__meta">${D.manifest.length} ファイル</span></div>
        <div class="sim-table-wrap">${table(D.manifest, [
          { label: 'ファイル', field: 'file' },
          { label: 'bytes', numeric: true, get: r => int(r.bytes) },
          { label: 'sha256', raw: true, get: r => `<code class="sim-hash">${esc(r.sha256)}</code>` }
        ])}</div>
      </article>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">RawLogs</p><h3>生ログ</h3></div></div>
        <div class="sim-defs">
          <div class="sim-def"><b>ファイル名</b><span>${esc(D.meta.rawLogs.file)}</span></div>
          <div class="sim-def"><b>ラウンド数</b><span>${int(D.meta.rawLogs.rounds)}</span></div>
          <div class="sim-def"><b>CSVサイズ</b><span>${D.meta.rawLogs.csvMB} MB</span></div>
          <div class="sim-def"><b>ZIPサイズ</b><span>${D.meta.rawLogs.zipMB} MB</span></div>
          <div class="sim-def"><b>文字コード</b><span>${esc(D.meta.rawLogs.encoding)}</span></div>
          <div class="sim-def"><b>再現キー</b><span>${esc(D.meta.reproKeys)}</span></div>
        </div>
        <p class="panel__note">生ログ100万行はCSVで553.8MBあるため、このページには含めていない。上のZIPを解凍して参照する。</p>
      </article>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">pytest</p><h3>自動テスト</h3></div><span class="panel__meta">${D.meta.testsPassed} 件</span></div>
        <pre class="sim-log">${esc(D.pytest)}</pre>
      </article>`;
  }

  // ---- タブ切替 -------------------------------------------------------------
  const PANES = {
    overview: { build: paneOverview },
    conditions: { build: paneConditions, after: () => { bindConditions(); renderConditions(); } },
    paired: { build: panePaired, after: renderPaired },
    detail: { build: paneDetail, after: () => { renderPicker(); renderDetail(); } },
    integrity: { build: paneIntegrity }
  };
  let activePane = 'overview';

  function bindConditions() {
    $('#simCondSearch').addEventListener('input', renderConditions);
    $('#simCondSort').addEventListener('change', renderConditions);
  }

  function renderPane() {
    const pane = PANES[activePane] || PANES.overview;
    $('#simPanes').innerHTML = pane.build();
    pane.after?.();
  }

  function setNotice(html) {
    const host = $('#simPanes');
    if (host) host.innerHTML = html;
  }

  async function decrypt(buffer, password) {
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength < 49) throw new Error('sim.enc が小さすぎる');
    if (new TextDecoder().decode(bytes.slice(0, 4)) !== MAGIC) throw new Error('sim.enc の形式が不明');
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: bytes.slice(4, 20), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(20, 32), additionalData: enc.encode(AAD_TEXT), tagLength: 128 },
      key, bytes.slice(32)
    );
    const data = JSON.parse(new TextDecoder().decode(plain));
    if (data.format !== 'xross-sim-data') throw new Error('sim.enc の中身が想定と違う');
    return data;
  }

  let loading = false;

  /** app.js が解錠に成功したら呼ぶ。統計と同じパスワードで sim.enc を復号する。 */
  async function load(password) {
    if (D || loading) return;
    loading = true;
    setNotice('<div class="empty-state">シミュレーション結果を復号している…</div>');
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`sim.enc を取得できない (${res.status})`);
      D = await decrypt(await res.arrayBuffer(), password);
      selected = condKey(D.condition[0]);
      $('#simCountBadge strong').textContent = int(D.meta.rounds);
      $('#simLead').textContent = `Round 1 のみ / ${int(D.meta.rounds)}回 / ${D.meta.conditions}条件 / ベースseed ${D.meta.baseSeed}`;
      renderPane();
    } catch (error) {
      console.error(error);
      D = null;
      setNotice(`<div class="empty-state"><strong>シミュレーション結果を読み込めなかった</strong>${esc(error.message)}</div>`);
    } finally {
      loading = false;
    }
  }

  function init() {
    if (!$('#simPanes')) return;
    setNotice('<div class="empty-state">シミュレーション結果を読み込んでいる…</div>');
    $('#simTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-sim-tab]');
      if (!b || !D) return;
      activePane = b.dataset.simTab;
      $$('#simTabs button').forEach(x => x.classList.toggle('is-active', x === b));
      renderPane();
    });
    // 条件チップは差し替えで消えるので、親に委譲する
    $('#simPanes').addEventListener('click', e => {
      const c = e.target.closest('[data-sim-cond]');
      if (!c || !D) return;
      selected = c.dataset.simCond;
      renderPicker();
      renderDetail();
    });
  }

  // app.js から解錠を受け取る窓口
  window.XROSS_SIM = { load };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
