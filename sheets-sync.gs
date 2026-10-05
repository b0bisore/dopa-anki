/**
 * ドパアンキ(全ゲーム共通の倉庫)→ スプレッドシート 自動コピー
 *
 * 使い方
 * 1. 新しいGoogleスプレッドシートを作り、「拡張機能」→「Apps Script」を開く
 * 2. このファイルの中身を全部貼り付けて保存
 * 3. 左の歯車「プロジェクトの設定」→「スクリプト プロパティ」に2つ追加
 *      SUPABASE_URL          … Project URL(https://xxxx.supabase.co)
 *      SUPABASE_SERVICE_KEY  … service_role キー(倉庫の合鍵。ここ以外に絶対に貼らない)
 * 4. 上のメニューで「syncAll」を選んで「実行」(初回だけ許可を求められます)
 * 5. 左の時計マーク「トリガー」→「トリガーを追加」→ syncAll / 時間主導型 / 1時間おき
 *
 * ⚠ このスプレッドシートの「編集権限」は他の人に渡さないでください(合鍵が見えてしまうため)。
 */
function syncAll() {
  writeSheet_('日別集計', callRpc_('admin_daily_summary'),
    ['日付', 'ゲーム', 'プレイ回数', '遊んだ人数', '平均正答率(%)'],
    r => [r.day, r.game_id, r.plays, r.players, r.avg_correct]);
  writeSheet_('プレイヤー', callRpc_('admin_players'),
    ['ランキング名', 'ゲーム', 'EXP', 'レベル', 'プレイ回数', '最後に遊んだ日時', '初回'],
    r => [r.nickname || '(未設定)', r.game_id, r.xp, r.lv, r.plays, r.last_played, r.created_at]);
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

function writeSheet_(title, rows, header, toRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(title) || ss.insertSheet(title);
  sh.clearContents();
  const values = [header].concat(rows.map(toRow));
  sh.getRange(1, 1, values.length, header.length).setValues(values);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(values.length + 2, 1).setValue('最終更新: ' + new Date().toLocaleString('ja-JP'));
}
