(() => {
  'use strict';

  const D = window.SIM_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const int = v => new Intl.NumberFormat('ja-JP').format(Number(v) || 0);
  const pct = (v, d = 1) => v == null ? '—' : `${(Number(v) * 100).toFixed(d)}%`;
  const num = (v, d = 2) => v == null ? '—' : Number(v).toFixed(d);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const key = r => `${r.matchup_id}|${r.position}|${r.player_tactic}|${r.opponent_tactic}`;
  const label = r => `${r.matchup_name} / ${r.position} / 自${r.player_tactic} × 相${r.opponent_tactic}`;

  /** 勝率50%を中心に発散するバー。右へ伸びるほど有利。 */
  const winBar = rate => {
    const v = Math.min(Math.max(Number(rate) || 0, 0), 1);
    const tone = v >= .55 ? 'is-good' : v <= .45 ? 'is-bad' : 'is-even';
    return `<div class="mu-bar ${tone}"><i style="left:${(Math.min(v, .5) * 100).toFixed(2)}%;width:${Math.max(Math.abs(v - .5) * 100, .8).toFixed(2)}%"></i></div>`;
  };

  /** 0起点の割合バー（構成比・分布用） */
  const shareBar = (rate, max = 1, tone = '') =>
    `<div class="sim-bar ${tone}"><i style="width:${Math.max((Number(rate) || 0) / max * 100, .6).toFixed(2)}%"></i></div>`;

  /** 95%信頼区間を目盛り付きで描く */
  const ciBar = (low, high, point) => {
    const l = Number(low) * 100, h = Number(high) * 100, p = Number(point) * 100;
    return `<div class="sim-ci" title="95%信頼区間 ${pct(low, 2)} 〜 ${pct(high, 2)}">
      <i class="sim-ci__range" style="left:${l.toFixed(2)}%;width:${Math.max(h - l, .4).toFixed(2)}%"></i>
      <i class="sim-ci__point" style="left:${p.toFixed(2)}%"></i>
      <b class="sim-ci__mid">50</b>
    </div>`;
  };

  const table = (rows, cols) => {
    if (!rows.length) return '<div class="empty-state">データがない。</div>';
    return `<table class="sim-table"><thead><tr>${cols.map(c =>
      `<th class="${c.numeric ? 'is-num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => {
        const v = c.get ? c.get(r) : r[c.field];
        return `<td class="${c.numeric ? 'is-num' : ''}">${c.raw ? v : esc(v ?? '—')}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  };

  // ---- 概要 -----------------------------------------------------------------
  function renderOverview() {
    const m = D.meta;
    $('#heroRounds').textContent = '100万';
    $('#heroLead').textContent = `Round 1 のみ / ${int(m.rounds)}回 / ${m.conditions}条件 / ベースseed ${m.baseSeed}`;

    const best = [...D.condition].sort((a, b) => b.total_win_rate - a.total_win_rate)[0];
    const worst = [...D.condition].sort((a, b) => a.total_win_rate - b.total_win_rate)[0];
    const kpis = [
      { label: '累計ラウンド', value: int(m.rounds), sub: `前回 ${int(m.previousRounds)} + 追加 ${int(m.addedRounds)}` },
      { label: '条件数', value: m.conditions, sub: `1条件あたり ${m.roundsPerCondition}回` },
      { label: '最高勝率', value: pct(best.total_win_rate), sub: `${best.matchup_name} / ${best.position}` },
      { label: '最低勝率', value: pct(worst.total_win_rate), sub: `${worst.matchup_name} / ${worst.position}` }
    ];
    $('#kpiGrid').innerHTML = kpis.map((k, i) => `
      <article class="kpi-card">
        <div class="kpi-card__index"><span>0${i + 1}</span><span>${esc(k.label)}</span></div>
        <strong class="kpi-card__value">${esc(k.value)}</strong>
        <span class="kpi-card__sub">${esc(k.sub)}</span>
      </article>`).join('');

    const defs = [
      ['対象', m.scope], ['前回累計', `${int(m.previousRounds)}回`], ['今回追加', `${int(m.addedRounds)}回`],
      ['新しい累計', `${int(m.rounds)}回`], ['条件数', `${m.conditions}`],
      ['各条件の累計', `${m.roundsPerCondition}回`], ['追加回数の範囲', `${m.addedPerCondition}回`],
      ['追加バッチファイル', `${m.batchFiles}`], ['ベースseed', `${m.baseSeed}`],
      ['追加index範囲', m.indexRange], ['後攻ペア比較', m.pairNote],
      ['再現キー', m.reproKeys], ['自動テスト', `${m.testsPassed}件合格`],
      ['異常 / 未決着', `${D.validation.anomalies} / ${D.validation.unresolved}`],
      ['モデルの前提', m.modelNote]
    ];
    $('#runConditions').innerHTML = defs.map(([k, v]) =>
      `<div class="sim-def"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');

    // 対面ごとに条件をまとめ、総ラウンドと加重勝率を出す
    const groups = new Map();
    D.condition.forEach(r => {
      const g = groups.get(r.matchup_name) || { name: r.matchup_name, rounds: 0, wins: 0, rows: [] };
      g.rounds += r.total_rounds; g.wins += r.wins; g.rows.push(r);
      groups.set(r.matchup_name, g);
    });
    $('#matchupSummary').innerHTML = [...groups.values()]
      .map(g => ({ ...g, rate: g.rounds ? g.wins / g.rounds : 0 }))
      .sort((a, b) => b.rate - a.rate)
      .map(g => `<div class="sim-matchup">
        <div class="sim-matchup__head"><b>${esc(g.name)}</b><span>${pct(g.rate)}</span></div>
        ${winBar(g.rate)}
        <small>${g.rows.length}条件 / ${int(g.rounds)}ラウンド / ${int(g.wins)}勝</small>
      </div>`).join('');
  }

  // ---- 条件比較 -------------------------------------------------------------
  const COND_COLS = [
    { label: 'matchup_id', field: 'matchup_id' },
    { label: '対面', field: 'matchup_name' },
    { label: '先後', field: 'position' },
    { label: '自タクティクス', field: 'player_tactic' },
    { label: '相手タクティクス', field: 'opponent_tactic' },
    { label: '前回ラウンド', numeric: true, get: r => int(r.previous_rounds) },
    { label: '前回勝率', numeric: true, get: r => pct(r.previous_win_rate, 2) },
    { label: '追加ラウンド', numeric: true, get: r => int(r.added_rounds) },
    { label: '追加勝率', numeric: true, get: r => pct(r.added_win_rate, 2) },
    { label: '差（追加−前回）', numeric: true, get: r => `${r.delta_added_minus_previous >= 0 ? '+' : ''}${(r.delta_added_minus_previous * 100).toFixed(2)}pt` },
    { label: '総ラウンド', numeric: true, get: r => int(r.total_rounds) },
    { label: '勝', numeric: true, get: r => int(r.wins) },
    { label: '負', numeric: true, get: r => int(r.losses) },
    { label: '両者敗北', numeric: true, get: r => int(r.both_loss) },
    { label: '総合勝率', numeric: true, get: r => pct(r.total_win_rate, 2) },
    { label: 'CI95下限', numeric: true, get: r => pct(r.ci95_low, 2) },
    { label: 'CI95上限', numeric: true, get: r => pct(r.ci95_high, 2) },
    { label: '平均ハーフターン', numeric: true, get: r => num(r.mean_half_turns, 3) },
    { label: '自分の平均ターン', numeric: true, get: r => num(r.mean_player_turns, 3) },
    { label: '相手の平均ターン', numeric: true, get: r => num(r.mean_opponent_turns, 3) },
    { label: 'PPチケット使用率', numeric: true, get: r => pct(r.pp_ticket_use_rate, 2) }
  ];

  function renderConditions() {
    const q = $('#condSearch').value.trim().toLowerCase();
    const sort = $('#condSort').value;
    const sorters = {
      winrate: (a, b) => b.total_win_rate - a.total_win_rate,
      delta: (a, b) => Math.abs(b.delta_added_minus_previous) - Math.abs(a.delta_added_minus_previous),
      turns: (a, b) => a.mean_half_turns - b.mean_half_turns,
      pp: (a, b) => b.pp_ticket_use_rate - a.pp_ticket_use_rate,
      name: (a, b) => a.matchup_name.localeCompare(b.matchup_name, 'ja') || a.position.localeCompare(b.position, 'ja')
    };
    const rows = D.condition
      .filter(r => !q || label(r).toLowerCase().includes(q) || r.matchup_id.includes(q))
      .sort(sorters[sort] || sorters.winrate);

    $('#condList').innerHTML = rows.length ? rows.map(r => {
      const delta = r.delta_added_minus_previous;
      return `<article class="sim-cond">
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
          <div><span>差</span><b class="${delta >= 0 ? 'is-up' : 'is-down'}">${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)}pt</b></div>
          <div><span>平均HT</span><b>${num(r.mean_half_turns, 2)}</b></div>
          <div><span>PP使用</span><b>${pct(r.pp_ticket_use_rate)}</b></div>
        </div>
      </article>`;
    }).join('') : '<div class="empty-state"><strong>該当する条件がない</strong>検索語を変えて。</div>';

    $('#condTable').innerHTML = table(rows, COND_COLS);
  }

  // ---- 後攻ペア比較 ---------------------------------------------------------
  function renderPaired() {
    $('#pairedCount').textContent = D.paired.length;
    $('#pairedList').innerHTML = D.paired.map(r => {
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
            <span>サイバネ − アドレナリン</span>
            <strong>${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)}pt</strong>
          </div>
        </div>
        <div class="sim-pair__vs">
          <div><span>アドレナリン</span><strong>${pct(r.adrenaline_win_rate)}</strong><small>${int(r.adrenaline_wins)}勝</small>${winBar(r.adrenaline_win_rate)}</div>
          <div><span>サイバネアーマー</span><strong>${pct(r.cyber_win_rate)}</strong><small>${int(r.cyber_wins)}勝</small>${winBar(r.cyber_win_rate)}</div>
        </div>
        <div class="sim-pair__stack" role="img" aria-label="同一seedでの勝敗の重なり">
          ${seg.map(([cls, name, v]) => `<i class="is-${cls}" style="flex:${v || 0}" title="${name} ${int(v)} (${pct((v || 0) / total)})"></i>`).join('')}
        </div>
        <div class="sim-pair__legend">
          ${seg.map(([cls, name, v]) => `<span class="is-${cls}"><b>${esc(name)}</b>${int(v)}<i>${pct((v || 0) / total)}</i></span>`).join('')}
        </div>
      </article>`;
    }).join('');

    $('#pairedTable').innerHTML = table(D.paired, [
      { label: 'matchup_id', field: 'matchup_id' },
      { label: '対面', field: 'matchup_name' },
      { label: '相手タクティクス', field: 'opponent_tactic' },
      { label: 'ペア数', numeric: true, get: r => int(r.paired_rounds) },
      { label: 'アドレ勝数', numeric: true, get: r => int(r.adrenaline_wins) },
      { label: 'サイバネ勝数', numeric: true, get: r => int(r.cyber_wins) },
      { label: 'アドレ勝率', numeric: true, get: r => pct(r.adrenaline_win_rate, 2) },
      { label: 'サイバネ勝率', numeric: true, get: r => pct(r.cyber_win_rate, 2) },
      { label: '差', numeric: true, get: r => `${r.delta_cyber_minus_adrenaline >= 0 ? '+' : ''}${(r.delta_cyber_minus_adrenaline * 100).toFixed(2)}pt` },
      { label: '両方勝ち', numeric: true, get: r => int(r.both_win) },
      { label: 'アドレのみ', numeric: true, get: r => int(r.adrenaline_only_win) },
      { label: 'サイバネのみ', numeric: true, get: r => int(r.cyber_only_win) },
      { label: '両方負け', numeric: true, get: r => int(r.both_loss) }
    ]);
  }

  // ---- 条件詳細 -------------------------------------------------------------
  let selected = key(D.condition[0]);

  function renderPicker() {
    $('#condPicker').innerHTML = D.condition.map(r => `
      <button class="sim-chip ${key(r) === selected ? 'is-active' : ''}" type="button" data-cond="${esc(key(r))}">
        <b>${esc(r.matchup_name)}</b>
        <span>${esc(r.position)} / 自${esc(r.player_tactic)}</span>
        <small>相${esc(r.opponent_tactic)} ・ ${pct(r.total_win_rate)}</small>
      </button>`).join('');
  }

  const distPanel = (title, meta, rows, cols, barField, labelField, extra = '') => {
    const max = Math.max(...rows.map(r => r[barField] || 0), 0.0001);
    return `<article class="panel">
      <div class="panel__head"><div><p class="kicker">${esc(meta)}</p><h3>${esc(title)}</h3></div><span class="panel__meta">${rows.length} 行</span></div>
      ${extra}
      <div class="sim-dist">${rows.length ? rows.map(r => `
        <div class="sim-dist__row">
          <div class="sim-dist__label">${esc(r[labelField])}</div>
          ${shareBar(r[barField], max)}
          <div class="sim-dist__value"><b>${pct(r[barField], 2)}</b><small>${int(r.count)}</small></div>
        </div>`).join('') : '<div class="empty-state">この条件では記録なし。</div>'}</div>
      <div class="sim-table-wrap">${table(rows, cols)}</div>
    </article>`;
  };

  function renderDetail() {
    const cond = D.condition.find(r => key(r) === selected);
    if (!cond) return;
    $('#detailRounds').textContent = int(cond.total_rounds);

    const pick = list => list.filter(r => key(r) === selected);
    const ft = pick(D.finishTurn).sort((a, b) => a.half_turns - b.half_turns);
    const cb = pick(D.combo).sort((a, b) => b.rate - a.rate);
    const lc = pick(D.lethalCard).sort((a, b) => b.share_of_player_wins - a.share_of_player_wins);
    const hp = pick(D.lethalHp).sort((a, b) => a.rank - b.rank);
    const pp = pick(D.ppTicket).sort((a, b) => a.use_turn - b.use_turn);
    const ad = pick(D.adrenaline)[0];

    const base = [
      { label: 'matchup_id', field: 'matchup_id' },
      { label: '対面', field: 'matchup_name' },
      { label: '先後', field: 'position' },
      { label: '自タクティクス', field: 'player_tactic' },
      { label: '相手タクティクス', field: 'opponent_tactic' }
    ];

    const header = `<article class="panel sim-detail-head">
      <div class="panel__head"><div><p class="kicker">SELECTED</p><h3>${esc(cond.matchup_name)}</h3></div>
        <span class="panel__meta">${esc(cond.matchup_id)}</span></div>
      <div class="sim-detail-grid">
        <div><span>先後</span><b>${esc(cond.position)}</b></div>
        <div><span>自タクティクス</span><b>${esc(cond.player_tactic)}</b></div>
        <div><span>相手タクティクス</span><b>${esc(cond.opponent_tactic)}</b></div>
        <div><span>総合勝率</span><b>${pct(cond.total_win_rate)}</b></div>
        <div><span>95%信頼区間</span><b>${pct(cond.ci95_low, 2)} 〜 ${pct(cond.ci95_high, 2)}</b></div>
        <div><span>総ラウンド</span><b>${int(cond.total_rounds)}</b></div>
        <div><span>勝 / 負</span><b>${int(cond.wins)} / ${int(cond.losses)}</b></div>
        <div><span>平均ハーフターン</span><b>${num(cond.mean_half_turns, 3)}</b></div>
        <div><span>自分の平均ターン</span><b>${num(cond.mean_player_turns, 3)}</b></div>
        <div><span>相手の平均ターン</span><b>${num(cond.mean_opponent_turns, 3)}</b></div>
        <div><span>PPチケット使用率</span><b>${pct(cond.pp_ticket_use_rate, 2)}</b></div>
        <div><span>両者敗北</span><b>${int(cond.both_loss)}</b></div>
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

    $('#detailPanels').innerHTML = header
      + distPanel('決着ハーフターン分布', '03_finish_turn_distribution', ft,
          [...base, { label: 'ハーフターン', numeric: true, field: 'half_turns' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '比率', numeric: true, get: r => pct(r.rate, 3) }], 'rate', 'half_turns',
          `<p class="panel__note">ハーフターン＝先後合わせた手番数。平均 ${num(cond.mean_half_turns, 3)}。</p>`)
      + distPanel('コンボ成立分布', '04_combo_distribution', cb,
          [...base, { label: 'コンボ', field: 'combo_class' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '比率', numeric: true, get: r => pct(r.rate, 3) }], 'rate', 'combo_class')
      + distPanel('最終リーサルカード', '05_lethal_card_distribution', lc,
          [...base, { label: 'カード', field: 'lethal_card' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '自分の勝ちに占める比率', numeric: true, get: r => pct(r.share_of_player_wins, 3) }],
          'share_of_player_wins', 'lethal_card')
      + `<article class="panel">
          <div class="panel__head"><div><p class="kicker">06_lethal_hp_top_patterns</p><h3>リーサルターン開始時のHPパターン</h3></div><span class="panel__meta">${hp.length} 行</span></div>
          <div class="sim-table-wrap">${table(hp, [...base,
            { label: '順位', numeric: true, field: 'rank' },
            { label: 'HPベクトル', field: 'hp_vector' },
            { label: '昇順HP', field: 'sorted_hp_vector' },
            { label: '生存数', numeric: true, field: 'alive_count' },
            { label: '合計HP', numeric: true, get: r => int(r.total_hp) },
            { label: '件数', numeric: true, get: r => int(r.count) },
            { label: '自分の勝ちに占める比率', numeric: true, get: r => pct(r.share_of_player_wins, 3) }])}</div>
        </article>`
      + distPanel('PPチケット使用ターン', '07_pp_ticket_turns', pp,
          [...base, { label: '使用ターン', numeric: true, field: 'use_turn' },
           { label: '件数', numeric: true, get: r => int(r.count) },
           { label: '使用に占める比率', numeric: true, get: r => pct(r.share_of_uses, 3) }],
          'share_of_uses', 'use_turn',
          `<p class="panel__note">この条件の使用率は ${pct(cond.pp_ticket_use_rate, 2)}。</p>`)
      + adPanel;
  }

  // ---- 検証 -----------------------------------------------------------------
  function renderIntegrity() {
    const kv = obj => Object.entries(obj)
      .filter(([, v]) => typeof v !== 'object' || v === null)
      .map(([k, v]) => `<div class="sim-def"><b>${esc(k)}</b><span>${esc(typeof v === 'boolean' ? (v ? 'OK' : 'NG') : v)}</span></div>`).join('');

    const badge = ok => `<span class="sim-badge ${ok ? 'is-ok' : 'is-ng'}">${ok ? 'OK' : 'NG'}</span>`;

    $('#integrityPanels').innerHTML = `
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
        <p class="panel__note">生ログ100万行はサイズの都合でこのページには含めていない。上のZIPを解凍して参照する。</p>
      </article>
      <article class="panel">
        <div class="panel__head"><div><p class="kicker">pytest</p><h3>自動テスト</h3></div><span class="panel__meta">${D.meta.testsPassed} 件</span></div>
        <pre class="sim-log">${esc(D.pytest)}</pre>
      </article>`;
  }

  // ---- 起動 -----------------------------------------------------------------
  function bind() {
    $('#condSearch').addEventListener('input', renderConditions);
    $('#condSort').addEventListener('change', renderConditions);
    $('#condPicker').addEventListener('click', e => {
      const b = e.target.closest('[data-cond]');
      if (!b) return;
      selected = b.dataset.cond;
      renderPicker();
      renderDetail();
    });
    document.addEventListener('click', e => {
      const j = e.target.closest('[data-jump]');
      if (!j) return;
      $$('.desktop-nav .nav__item').forEach(n => n.classList.toggle('is-active', n === j));
      $(`#${j.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // スクロールで現在地を追う
    const sections = $$('.sim-section');
    const io = new IntersectionObserver(entries => {
      entries.filter(en => en.isIntersecting).forEach(en => {
        $$('.desktop-nav .nav__item').forEach(n =>
          n.classList.toggle('is-active', n.dataset.jump === en.target.id));
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    sections.forEach(s => io.observe(s));
  }

  renderOverview();
  renderConditions();
  renderPaired();
  renderPicker();
  renderDetail();
  renderIntegrity();
  bind();
  $$('.sim-section').forEach(s => s.classList.add('is-motion-ready'));
})();
