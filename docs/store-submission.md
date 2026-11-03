# Chrome ウェブストアに出す手順(人の作業)

拡張をストアに置くまでの手順。**ストアに上げる・公開するのは人の作業**(AI はやらない)。
掲載文・権限の理由・プライバシーの回答はすべて `extension/store/listing.md` にある。画面に貼るだけ。

## 0. 先に決めること

- **公開範囲**: 「公開」にする(ストアの検索で見つかり、誰でも無料で入れられる)。`selectors/note.json` は 2026-10-29 に実機で全工程 ✓ を確認済み。note の画面が変わって ✗ になったときは、`selectors/note.json` を直して main に push すれば、拡張を出し直さずに全員に届く。限定公開(URL を知っている人だけ)にしたいときは、公開範囲だけを切り替えられる
- **料金**: 「料金なし」。拡張の中に購入の機能は無い
- **プライバシーポリシーの URL**: 審査で必須。https://shibuhachi.works/last-one-click/privacy/ を使う(portfolio リポジトリの `src/pages/last-one-click/privacy.astro`。文面は `docs/PRIVACY.md` と同じに保つ)。ホームページ URL は https://shibuhachi.works/last-one-click/

## 1. 準備(1 回だけ)

1. Chrome ウェブストアのデベロッパー登録(Google アカウント、登録料は 1 回だけ): https://chrome.google.com/webstore/devconsole
2. 登録後、デベロッパー ダッシュボードの「アカウント」で、メールアドレスの確認と、公開者名の設定を済ませる(公開者名はストアに表示される)

## 2. ZIP を作る

**ストアに上げる ZIP は、GitHub のリリースに添えたものを使う。** `release.yml`(Actions の「リリースを作る」)が、指定したコミットから ZIP を作ってリリースに添える。手元で作り直さない(ZIP は作るたびに中身の時刻が変わるので、リリースの ZIP と、ストアに上げた ZIP が別のものになる)。

1. `manifest.json` の `version` を上げた PR をマージする。`docs/releases/v<version>.md`(リリースの本文)も、その PR で置く
2. Actions の「リリースを作る」を、タグ(例: `v0.1.2`)とコミット(40 文字の SHA)を指定して起動する
3. できたリリースから `last-one-click-<version>.zip` をダウンロードして、3. でストアに上げる。本文の末尾に SHA-256 が書いてあるので、ダウンロードした ZIP と合うか確かめる

手元で動作を確かめたいときだけ、次で ZIP を作れる(ストアには上げない)。

```bash
cd extension
npm ci
npm run package     # → extension/release/last-one-click-<version>.zip
```

- `manifest.json` の `version` を上げるのは、ストアに上げ直すとき(同じ version は再アップロードできない)
- ZIP の中身は `dist/` の中身そのもの(`manifest.json` が直下)。中に `.map` やソースは入らない
- 画像(アイコン・スクリーンショット)を作り直すときだけ、リポジトリ直下で `npm ci && npx playwright install chromium` をしてから `npm run icons` / `npm run screenshots`(画像はコミット済みなので、普段は不要)

## 3. ストアに上げる

1. ダッシュボード →(初回は「新しいアイテム」。2 回目以降は、アイテムの「パッケージ」→「新しいパッケージをアップロード」)→ ZIP を上げる。名前を変えた版も、新しいアイテムは作らず、同じアイテムを更新する(ID とストアの URL が変わらない)
2. **ストアの掲載情報**: `extension/store/listing.md` の「基本」「詳細な説明」を貼る。カテゴリは「仕事効率化」、言語は「日本語」
3. **画像**: スクリーンショット `extension/store/screenshot-1.png` 〜 `screenshot-5.png`(1280x800、5 枚とも)を番号順に上げる。可能なら実機で note のエディタに入力された状態も 1 枚撮って足す(記事本文・アカウント名が写らないもの)。小さなプロモタイルは `extension/store/promo-small.png`
4. **プライバシーへの取り組み**: `listing.md` の「単一の目的」「権限の理由」「リモートコード」「データの使用」をそのまま回答する。プライバシーポリシー URL を入れる
5. **公開設定**: 決済方法は「料金なし」、公開範囲は「公開」(0. の判断どおり)。配布地域はすべて
6. 「審査のため送信」。「審査の合格後に自動的に公開する」を外すと、合格後に自分で公開を押すまで待てる(告知の日に合わせたいとき)

## 4. 審査中・審査後

- 審査は通常 1〜3 日。ホスト権限が付いているので、権限の理由が薄いと差し戻される。差し戻しのメールが来たら、本文を Issue に貼れば AI が回答案と修正 PR を作る
- 公開されたら、ストアの URL を AI に渡す。紹介ページ(portfolio リポジトリ)の `storeUrl` を入れる PR と、`docs/ROADMAP.md` の「Chrome ウェブストアに公開」にチェックを入れる PR を作る
- 版のタグとリリースは、`docs/releases/<タグ名>.md` に本文を置く PR をマージしたあと、Actions の「リリースを作る」を起動して作る(タグ名と、ストアに上げた版のコミットの SHA を入れる)。AI の作業環境からはタグもリリースも直接は作れないので、この workflow を使う。main の先頭なら workflow がタグも作る。古いコミット(main と workflow ファイルが違う)にリリースを作るときは、人が先に `git tag -a <タグ名> <SHA>` → `git push origin <タグ名>` でタグを打ってから起動する(Actions の token では作れない)

## 5. 次に上げ直すとき

1. `manifest.json` の `version` を上げる(例: 0.1.0 → 0.1.1)
2. `npm run package` → ダッシュボードの「パッケージ」→「新しいパッケージをアップロード」
3. 掲載情報・プライバシーの回答に変更があれば `listing.md` を先に直してから画面に反映する

## 守ること(AGENTS.md / extension/README と同じ)

- 説明文に「認証情報を扱わない」「公開ボタンは押さない」「非公式ツール」を明記する(listing.md に入っている)
- `host_permissions` を増やさない(増やすと審査が厳しくなる)
- セレクタの修正だけなら、`selectors/note.json` を main に push すれば全ユーザーに届く。ストアの再申請は不要
