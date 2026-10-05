/**
 * ドパ暗記の倉庫(Supabase)→「全ゲーム集計」スプレッドシート 自動コピー
 *
 * 使い方
 * 1. スプレッドシートを開き、「拡張機能」→「Apps Script」を開く
 * 2. 「+」→「スクリプト」で新しいファイルを足し、このファイルの中身を全部貼り付けて保存
 *    (最初からある「コード.gs」(毎晩の日別記録)はそのまま残す)
 * 3. 左の歯車「プロジェクトの設定」→「スクリプト プロパティ」に2つ追加
 *      SUPABASE_URL          … Project URL(https://xxxx.supabase.co)
 *      SUPABASE_SERVICE_KEY  … service_role キー(Secret key。倉庫の合鍵。ここ以外に絶対に貼らない)
 * 4. 上のメニューで「setupSync」を選んで「実行」(初回だけ許可を求められます)
 *    → 1時間ごとの自動集計が設定され、すぐに1回集計されます
 * 5. 「organizeSheets」を1回実行すると、まとめ表にドパ暗記の行が入り、タブが見やすく並びます
 *    (何度実行しても同じ形になるだけです)
 *
 * 書き換えるのは「ドパ暗記くわしく」タブだけです。ほかのタブには毎回は触りません。
 * ⚠ このスプレッドシートの「編集権限」は他の人に渡さないでください(合鍵が見えてしまうため)。
 */
const DOPA_GAME = 'dopa-anki';
const DOPA_SHEET = 'ドパ暗記くわしく';
const SUMMARY_SHEET = 'まとめ（最初に見る）';
const DOPA_TZ = 'Asia/Tokyo';
const DECK_JA = { eng: '英単語', toeic: 'TOEIC単語', kobun: '古文単語', kanbun: '漢文句法', math: '数学の解法',
  jhist: '日本史', chem: '元素記号', mix: 'ごちゃまぜ', daily: '今日の10問' };
const HEAD_BG = '#eef1f7';

// 1時間ごとの自動実行を設定して、1回すぐに集計する(最初に1回だけ実行)
function setupSync() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncAll').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAll').timeBased().everyHours(1).create();
  syncAll();
}

function syncAll() {
  const ev = callRpc_('admin_event_daily').filter(r => r.game_id === DOPA_GAME);
  const decks = callRpc_('admin_deck_daily').filter(r => r.game_id === DOPA_GAME);
  const players = callRpc_('admin_players').filter(r => r.game_id === DOPA_GAME);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(DOPA_SHEET) || ss.insertSheet(DOPA_SHEET);
  sh.clear();   // シート自体は消さない(まとめ表の式がこのシートを見ているため)

  // 日ごとの表
  const byDay = {};
  ev.forEach(r => {
    const o = byDay[r.day] || (byDay[r.day] = {});
    o[r.name] = Number(r.events); o[r.name + '_u'] = Number(r.users);
  });
  const days = Object.keys(byDay).sort().reverse();
  const dayRows = days.map(d => {
    const o = byDay[d], st = o.game_start || 0, en = o.game_end || 0;
    return [d.replace(/-/g, '/'), o.app_open || 0, o.app_open_u || 0, st, en, st ? en / st : '',
      o.game_start_u || 0, o.retry_start || 0, o.review_start || 0, o.explain_open || 0, o.ranking_view || 0];
  });
  const sum = i => dayRows.reduce((a, r) => a + (Number(r[i]) || 0), 0);

  let row = 1;
  sh.getRange(row, 1).setValue('ドパ暗記 のくわしい数字').setFontWeight('bold').setFontSize(14);
  sh.getRange(row + 1, 1).setValue('1時間ごとに自動で書き直されます(最終更新: '
    + Utilities.formatDate(new Date(), DOPA_TZ, 'yyyy/MM/dd HH:mm') + ')。このタブは手で書き込まないでください。')
    .setFontColor('#666666');

  // これまでの合計(B6・C6 は「まとめ」タブから参照しているので位置を変えない)
  row = 4;
  title_(sh, row, '■ これまでの合計');
  table_(sh, row + 1, ['サイト訪問', 'プレイ開始', 'プレイ完了', '最後まで遊んだ割合', '再挑戦', '覚え方で復習', '解説を開いた', 'ランキングを見た'],
    [[sum(1), sum(3), sum(4), sum(3) ? sum(4) / sum(3) : '', sum(7), sum(8), sum(9), sum(10)]]);
  sh.getRange(row + 2, 4).setNumberFormat('0%');

  // 日ごと
  row = 9;
  title_(sh, row, '■ 日ごとの数字(新しい日が上)');
  table_(sh, row + 1, ['日付', 'サイト訪問(回)', '訪れた人', 'プレイ開始', 'プレイ完了', '最後まで遊んだ割合', '遊んだ人',
    '再挑戦', '覚え方で復習', '解説を開いた', 'ランキングを見た'], dayRows, 'まだ記録がありません');
  if (dayRows.length) sh.getRange(row + 2, 6, dayRows.length, 1).setNumberFormat('0%');
  row += 2 + Math.max(1, dayRows.length) + 2;

  // 科目ごと
  title_(sh, row, '■ 科目ごとの数字(どの科目がよく遊ばれているか)');
  const deckRows = decks.map(r => [String(r.day).replace(/-/g, '/'), DECK_JA[r.deck] || r.deck || '(不明)',
    Number(r.starts) || 0, Number(r.ends) || 0, r.avg_score == null ? '' : Number(r.avg_score),
    r.avg_correct == null ? '' : Number(r.avg_correct) / 100]);
  table_(sh, row + 1, ['日付', '科目', 'プレイ開始', 'プレイ完了', '平均点', '平均正答率'], deckRows, 'まだ記録がありません');
  if (deckRows.length) sh.getRange(row + 2, 6, deckRows.length, 1).setNumberFormat('0%');
  row += 2 + Math.max(1, deckRows.length) + 2;

  // ランキング参加者(名前を付けたか、1回以上遊んだ人だけ)
  title_(sh, row, '■ ランキング参加者(EXPが多い順。不適切な名前は Supabase の profiles から消せます)');
  const fmt = v => v ? Utilities.formatDate(new Date(v), DOPA_TZ, 'yyyy/MM/dd HH:mm') : '';
  const pRows = players.filter(r => r.nickname || Number(r.plays) > 0)
    .sort((a, b) => Number(b.xp) - Number(a.xp))
    .map(r => [r.nickname || '(名前なし)', Number(r.xp) || 0, Number(r.lv) || 1, Number(r.plays) || 0, fmt(r.last_played)]);
  table_(sh, row + 1, ['ランキング名', 'EXP', 'レベル', 'プレイ回数', '最後に遊んだ日時'], pRows, 'まだ参加者がいません');

  sh.setFrozenRows(0);
  sh.setColumnWidth(1, 150);
  for (let c = 2; c <= 11; c++) sh.setColumnWidth(c, 105);

  // 以前の版で作っていた「集計_」タブが残っていれば片付ける(このスクリプトが作った集計だけ)
  ['集計_日別サマリー', '集計_科目別', '集計_イベント', '集計_プレイヤー'].forEach(n => {
    const old = ss.getSheetByName(n); if (old) ss.deleteSheet(old);
  });
}

function title_(sh, row, text) {
  sh.getRange(row, 1).setValue(text).setFontWeight('bold');
}
function table_(sh, row, header, rows, emptyText) {
  sh.getRange(row, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground(HEAD_BG).setWrap(true);
  if (rows.length) sh.getRange(row + 1, 1, rows.length, header.length).setValues(rows);
  else if (emptyText) sh.getRange(row + 1, 1).setValue(emptyText).setFontColor('#999999');
}

/* ---------- タブの整理(1回実行すればOK・何度実行しても同じ形になる) ---------- */
function organizeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(DOPA_SHEET)) syncAll();
  const dopa = ss.getSheetByName(DOPA_SHEET);
  const sum = ss.getSheets().find(s => s.getRange('A1').getValue() === 'ゲーム名');
  sum.setName(SUMMARY_SHEET);

  // まとめ表にドパ暗記の行を足す(まだ無ければ)
  const names = sum.getRange('A1:A30').getDisplayValues().map(r => r[0]);
  let totalRow = names.indexOf('全ゲーム合計') + 1;
  if (names.indexOf('ドパ暗記') < 0) {
    let last = 1;
    for (let i = 1; i < totalRow - 1; i++) if (names[i]) last = i + 1;   // 最後のゲーム行
    sum.insertRowAfter(last);
    const r = last + 1, ref = "'" + DOPA_SHEET + "'!";
    sum.getRange(r, 1, 1, 6).setValues([['ドパ暗記', '=' + ref + 'B6', '=' + ref + 'C6',
      '=IFERROR(TEXT(C' + r + '/B' + r + ',"0%"),"")', 'サイト内の操作記録(「' + DOPA_SHEET + '」タブ。1時間ごとに更新)',
      '=HYPERLINK("#gid=' + dopa.getSheetId() + '","開く")']]);
    totalRow++;
  }
  const lastGame = totalRow - 2;
  sum.getRange(totalRow, 2, 1, 2).setFormulas([['=ARRAYFORMULA(SUM(IFERROR(B2:B' + lastGame + ',0)))',
    '=ARRAYFORMULA(SUM(IFERROR(C2:C' + lastGame + ',0)))']]);

  // 見た目:見出しと合計の行に色、数字は3桁区切り
  sum.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground(HEAD_BG).setWrap(true).setVerticalAlignment('middle');
  sum.getRange(totalRow, 1, 1, 6).setFontWeight('bold').setBackground('#fff4d6');
  sum.getRange(2, 2, totalRow - 1, 2).setNumberFormat('#,##0');
  sum.setFrozenRows(1);
  sum.setColumnWidth(1, 300); sum.setColumnWidth(5, 330);

  // このファイルの見方(表の下)
  const g = totalRow + 4;
  sum.getRange(g - 1, 1, 30, 6).clearContent().clearFormat();
  const guide = [
    ['■ このファイルの見方', ''],
    ['タブ', '中身'],
    [SUMMARY_SHEET, '全ゲームの「遊ばれた回数」の合計。まずはここだけ見ればOK'],
    ['日別推移', '1日ごとに何回遊ばれたかの表とグラフ(毎晩23:50ごろ自動更新)'],
    [DOPA_SHEET, 'ドパ暗記の訪問数・科目ごとの人気・ランキング参加者(1時間ごとに自動更新)'],
    ['日別推移（過去分）', '記録の仕組みを作る前の分をさかのぼって数えたもの(もう増えません)'],
    ['日別記録', '「日別推移」を作るための元データ。見なくてOK・触らないでください'],
    ['', ''],
    ['■ ことばの意味', ''],
    ['プレイ開始', 'ゲームを始めた回数'],
    ['リザルト到達', '最後まで遊んで、結果画面まで行った回数'],
    ['最後まで遊んだ割合', 'リザルト到達 ÷ プレイ開始'],
  ];
  sum.getRange(g, 1, guide.length, 2).setValues(guide);
  [g, g + 8].forEach(r => sum.getRange(r, 1).setFontWeight('bold').setFontSize(12));
  sum.getRange(g + 1, 1, 1, 2).setFontWeight('bold').setBackground(HEAD_BG);

  // タブの並びと色(よく見る順)
  const order = [SUMMARY_SHEET, '日別推移', DOPA_SHEET, '日別推移（過去分）', '日別記録'];
  const color = ['#4a6cf7', '#4a6cf7', '#22a06b', '#b0b0b0', '#b0b0b0'];
  order.forEach((n, i) => {
    const s = ss.getSheetByName(n); if (!s) return;
    s.setTabColor(color[i]);
    ss.setActiveSheet(s); ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(sum);
}

function callRpc_(name) {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('SUPABASE_URL');
  const key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('スクリプト プロパティに SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください');
  const res = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: '{}',
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error(name + ' の取得に失敗: ' + res.getContentText());
  return JSON.parse(res.getContentText());
}
