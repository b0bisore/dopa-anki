/**
 * 全ゲーム共通の倉庫(Supabase)→ スプレッドシート 自動コピー
 *
 * 使い方(「全ゲーム集計」スプレッドシートに入れる場合)
 * 1. スプレッドシートを開き、「拡張機能」→「Apps Script」を開く
 * 2. このファイルの中身を全部貼り付けて保存(既存のコードがある場合は、新しいファイルを「+」で追加してそこに貼る)
 * 3. 左の歯車「プロジェクトの設定」→「スクリプト プロパティ」に2つ追加
 *      SUPABASE_URL          … Project URL(https://xxxx.supabase.co)
 *      SUPABASE_SERVICE_KEY  … service_role キー(Secret key。倉庫の合鍵。ここ以外に絶対に貼らない)
 * 4. 上のメニューで「setupSync」を選んで「実行」(初回だけ許可を求められます)
 *    → 1時間ごとの自動集計が設定され、すぐに1回集計されます
 *
 * 作られるシート(「集計_」で始まる名前だけを毎回書き直します。ほかのシートには触りません)
 *   集計_日別サマリー … 日付×ゲームごとの訪問・プレイ開始/完了・リザルト表示など
 *   集計_科目別       … 日付×ゲーム×科目ごとのプレイ数・平均点・正答率
 *   集計_イベント     … 記録されたすべての操作の日別回数と人数
 *   集計_プレイヤー   … ランキング名・ゲームごとのEXP・プレイ回数
 *
 * ⚠ このスプレッドシートの「編集権限」は他の人に渡さないでください(合鍵が見えてしまうため)。
 */
// 1時間ごとの自動実行を設定して、1回すぐに集計する(最初に1回だけ実行)
function setupSync() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncAll').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAll').timeBased().everyHours(1).create();
  syncAll();
}

function syncAll() {
  const ev = callRpc_('admin_event_daily');
  writeSheet_('集計_日別サマリー', summaryRows_(ev), SUMMARY_HEADER);
  writeSheet_('集計_科目別', callRpc_('admin_deck_daily').map(r =>
    [r.day, r.game_id, r.deck, r.starts, r.ends, r.avg_score, r.avg_correct]),
    ['日付', 'ゲーム', '科目', 'プレイ開始', 'プレイ完了', '平均点', '平均正答率(%)']);
  writeSheet_('集計_イベント', ev.map(r => [r.day, r.game_id, NAMES[r.name] || r.name, r.name, r.events, r.users]),
    ['日付', 'ゲーム', '操作', '操作ID', '回数', '人数']);
  writeSheet_('集計_プレイヤー', callRpc_('admin_players').map(r =>
    [r.nickname || '(未設定)', r.game_id, r.xp, r.lv, r.plays, r.last_played, r.created_at]),
    ['ランキング名', 'ゲーム', 'EXP', 'レベル', 'プレイ回数', '最後に遊んだ日時', '初回']);
}

const NAMES = {
  app_open: 'サイトを開いた', home_view: 'ホーム表示', start_sheet: 'スタート確認を開いた',
  game_start: 'プレイ開始', game_end: 'プレイ完了', result_view: 'リザルト表示',
  retry_start: '再挑戦', review_start: '覚え方で復習', explain_open: '解説を開いた',
  ranking_view: 'ランキング表示', nav: 'メニュー操作'
};
const SUMMARY_HEADER = ['日付', 'ゲーム', '訪問数', '訪問者数', 'ホーム表示', 'プレイ開始', 'プレイ完了', '完了率(%)',
  'プレイした人数', 'リザルト表示', '再挑戦', '復習', '解説表示', 'ランキング表示'];

function summaryRows_(ev) {
  const map = {};
  ev.forEach(r => {
    const k = r.day + '|' + r.game_id;
    const o = map[k] || (map[k] = { day: r.day, game: r.game_id });
    o[r.name] = Number(r.events); o[r.name + '_u'] = Number(r.users);
  });
  return Object.values(map).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : a.game.localeCompare(b.game)).map(o => {
    const st = o.game_start || 0, en = o.game_end || 0;
    return [o.day, o.game, o.app_open || 0, o.app_open_u || 0, o.home_view || 0, st, en,
      st ? Math.round(en / st * 1000) / 10 : '', o.game_start_u || 0, o.result_view || 0,
      o.retry_start || 0, o.review_start || 0, o.explain_open || 0, o.ranking_view || 0];
  });
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

function writeSheet_(title, rows, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(title) || ss.insertSheet(title);
  sh.clearContents();
  const values = [header].concat(rows);
  sh.getRange(1, 1, values.length, header.length).setValues(values);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(values.length + 2, 1).setValue('最終更新: ' + new Date().toLocaleString('ja-JP'));
}
