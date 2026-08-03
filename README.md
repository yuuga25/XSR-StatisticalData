# Xross Stats Dashboard

Excelの統計データを、スマホ・PCの両方で見やすく確認するための静的サイトです。

- 概要KPI、先攻/後攻、進行別勝率
- 総合・勝ち進行・負け進行のデッキランキング
- 最大4デッキの比較、類似デッキ検索
- リーダー / ACE / タクティクス単体統計
- デッキ別タクティクス順
- RawLogsの検索・絞り込み・全25列表示
- 元Excelの全15シートを確認できる「全データ」画面
- AES-GCM暗号化＋共通パスワード

## 重要

リポジトリへ生の `.xlsx` をアップロードしないでください。公開するデータは、暗号化済みの `data.enc` だけです。

共通パスワードはHTML・CSS・JavaScript・READMEへ書かないでください。サイトは、入力されたパスワードで `data.enc` の復号に成功した場合だけ開きます。

## GitHub Pagesへ公開

1. GitHubでリポジトリを作成する。
2. このフォルダの**中身**をリポジトリ直下へアップロードする。
3. GitHubのリポジトリで `Settings` → `Pages` を開く。
4. `Build and deployment` のSourceを `Deploy from a branch` にする。
5. Branchを `main`、Folderを `/(root)` にして保存する。
6. 表示されたPages URLを開く。

`index.html`、`styles.css`、`app.js`、`data.enc` が同じ階層にあれば動きます。

## Excelを更新する

1. `tools/update-data.html` をブラウザで開く。
2. 更新したExcelを選択する。
3. サイトで使用する共通パスワードを2回入力する。
4. `暗号化して data.enc を作る` を押す。
5. ダウンロードされた `data.enc` で、リポジトリ直下の古いファイルを置き換える。
6. commit / pushする。

HTML・CSS・JavaScriptを変更する必要はありません。シート名と列構成が同じであれば、行数や数値が変わっても自動で反映されます。

### パスワードを変更する場合

同じ更新手順で、新しいパスワードを入力して `data.enc` を作り直します。以降は新しいパスワードだけで開けます。

## 公開前の確認

### 簡単な確認

公開済みサイトを開いた後、上部の `Excel` ボタンから更新した `.xlsx` を選ぶと、ブラウザ内だけで一時表示できます。ページを再読み込みすると公開中の `data.enc` に戻ります。

### GitHub Pagesと同じ方式で確認

フォルダ内でローカルHTTPサーバーを起動します。

WindowsでPythonが入っている場合は `start-local.bat` をダブルクリックし、次のURLを開いてください。

```text
http://localhost:8080
```

またはターミナルで実行します。

```bash
python -m http.server 8080
```

## セキュリティ上の性質

このサイトは静的サイトのまま、Excel由来のJSONをPBKDF2-SHA-256とAES-256-GCMで暗号化しています。パスワードはファイル内に保存されません。

ただし、共通パスワードを知る人はデータを閲覧できます。パスワードが共有範囲外へ漏れた場合は、新しいパスワードで `data.enc` を作り直してください。

さらに強いアクセス制御が必要な場合は、ユーザーごとのログインを持つホスティングや、GitHub Enterprise Cloudのprivate Pagesなどが必要です。

## ファイル構成

```text
index.html               表示ページ
styles.css               デザイン・レスポンシブ・アニメーション
app.js                   復号、集計表示、検索、比較
 data.enc                暗号化済み統計データ
.nojekyll                GitHub Pages用
start-local.bat          Windowsローカル確認用
tools/update-data.html   Excel→data.enc更新ツール
```

## 使用ライブラリ

公開ページ本体は外部ライブラリなしで動作します。

`tools/update-data.html` と、公開ページ上のローカルExcel一時読込機能のみ、SheetJS Community Edition 0.20.3を公式CDNから読み込みます。
