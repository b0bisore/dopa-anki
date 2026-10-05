# ドパ暗記 公開手順

このフォルダの中身が「ドパ暗記」のサイト一式です。

| ファイル | 中身 |
|---|---|
| index.html | ゲーム本体 |
| config.js | データベースの住所と鍵を書くファイル(最初は空) |
| og.png | SNSでURLを貼ったときに出る画像 |
| icon.png | スマホのホーム画面やタブのアイコン |
| supabase/schema.sql | 全ゲーム共通の倉庫の設定(プレイヤー・成績・プレイ記録・TODAY問題・集計) |
| sheets-sync.gs | 倉庫の集計をスプレッドシートに自動コピーするスクリプト |

全体のイメージは「お店」と「倉庫」です。

- GitHub = 設計図の保管場所
- Vercel = お店(画面を公開する場所)
- Supabase = 倉庫(ランキングの点数とTODAY問題を保管する場所)

`config.js` が空のままでもゲームは遊べます。止まるのは、ランキングとTODAYの追加問題だけです。

---

## 1. GitHub に置き場所を作る(5分)

1. GitHub にログインし、右上の「+」→「New repository」を選ぶ
2. Repository name に `dopa-anki` と入れて「Create repository」を押す
3. 次の画面の「uploading an existing file」をクリック
4. このフォルダの中身(index.html、config.js、og.png、icon.png、supabase フォルダ、sheets-sync.gs、README.md)をまとめてドラッグ&ドロップする
5. 下の「Commit changes」を押す

## 2. Supabase(倉庫)を作る(10分)

1. https://supabase.com を開き、「Start your project」→「Continue with GitHub」でログインする
2. 「New project」を押して、次のように入力する
   - Name:`dopa-anki`
   - Database Password:自動生成のままでOK(念のためメモしておく)
   - Region:Northeast Asia (Tokyo)
3. 準備に1〜2分かかるので待つ
4. 左メニューの「SQL Editor」を開き、`supabase/schema.sql` の中身を全部貼り付けて「Run」を押す。「Success」と出ればOK
5. 左メニューの「Authentication」→「Sign In / Providers」を開き、「Allow anonymous sign-ins」をONにして保存する
   - これで、メール登録なしでランキングに参加できるようになります
6. 左メニューの「Project Settings」→「API Keys」(または「Data API」)を開き、次の2つをコピーする
   - Project URL(`https://xxxx.supabase.co` の形)
   - anon public key(長い英数字)

⚠ 「service_role」と書かれた鍵は、絶対にどこにも貼らないでください。これは倉庫の合鍵です。anon key は公開しても大丈夫な「入口の鍵」なので、サイトに書いて問題ありません。

## 3. config.js に住所と鍵を書く(2分)

1. GitHub の dopa-anki を開き、`config.js` をクリックして、右上の鉛筆マークを押す
2. `supabaseUrl: ""` の "" の中に Project URL、`supabaseAnonKey: ""` の "" の中に anon public key を貼る
3. 「Commit changes」を押す

## 4. Vercel(お店)で公開する(5分)

1. https://vercel.com を開き、「Sign Up」→「Continue with GitHub」でログインする
2. 「Add New…」→「Project」を選び、`dopa-anki` の「Import」を押す
3. Framework Preset は「Other」のまま「Deploy」を押す
4. 1分ほどで `https://dopa-anki.vercel.app` のようなURLができる。これが公開URLです

これ以降、GitHub のファイルを書き換えると、Vercel が自動で反映します。

---

## TODAY問題の追加方法

Supabase の「Table Editor」→「daily_packs」で行を追加します。

- game_id:`dopa-anki`
- date:`2026-10-6` の形(月日の頭に0を付けない)
- data:問題のデータ(JSON)

最初の1日分(2026-10-5)は、手順2-4の設定で入っています。毎朝自動で追加する仕組みは、公開後に作れます。

## 5. スプレッドシートで集計を見る(10分・任意)

`sheets-sync.gs` の先頭に手順を書いています。設定すると、1時間ごとに次の2枚のシートが自動で更新されます。

- **日別集計**:日付×ゲームごとのプレイ回数・遊んだ人数・平均正答率
- **プレイヤー**:ランキング名・ゲーム・EXP・レベル・プレイ回数・最後に遊んだ日時

ここで使う「service_role キー」は倉庫の合鍵です。スプレッドシートの設定画面(スクリプト プロパティ)にだけ貼り、そのシートの編集権限は他の人に渡さないでください。

## 他のゲームを増やすとき

この倉庫は、最初から複数のゲームで共有できる作りにしてあります。

1. Supabase の「Table Editor」→「games」に1行足す(例:id `next-game`、name `次のゲーム`)
2. 新しいゲームの中の `GAME_ID` をその id にする
3. 同じ `config.js`(同じ倉庫の住所と鍵)を使う

これで、日別集計・プレイヤー一覧・「全ゲーム」ランキングに自動で合算されます。

⚠ **プレイヤーを全ゲームで共通にするには、ゲームを同じサイトの中に置く必要があります。** 例えば `https://○○.vercel.app/dopa-anki/` と `https://○○.vercel.app/next-game/` のような形です。サイトが別々だと、同じ人でも別人として数えられます。別サイトにしたい場合は、あとから「ログインして引き継ぐ」機能を足します。

## 知っておくこと

- ランキング名は自由入力です。12文字までで、一部の不適切な言葉ははじきます。それ以外の不適切な名前は、Supabase の「Table Editor」→「players」から行を削除できます
- 点数は端末から送る仕組みなので、詳しい人なら不正な点数を送れてしまいます。上限(1日のベスト2000点)は付けていますが、本格的に競わせる段階で対策を強化します
- 遊んだ記録(レベル・称号・振り返り)は、それぞれの端末のブラウザに保存されます。別の端末には引き継がれません
