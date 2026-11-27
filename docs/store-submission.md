# Chrome ウェブストアに出す手順(人の作業)

拡張をストアに置くまでの手順。**「審査のため送信」(公開)は人の作業**(AI はやらない)。2 回目以降の版は、ZIP のアップロードだけを Actions の「リリースを作る」が行う(3. の「Actions でアップロードする」)。説明文・画像・プライバシーの回答は、申請用のツール(#215。設計中)ができるまで、ダッシュボードで人が入れる。
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

1. `manifest.json` の `version` を上げた PR(リリースの PR)をマージする。`docs/releases/v<version>.md`(リリースの本文)も、その PR で置く
   - `docs/releases/next.md`(main にためてきた、まだ出していない変更)を `docs/releases/v<version>.md` に名前を変えて、リリースの本文にする(冒頭の説明を版の紹介に直し、`v0.1.5.md` と同じ形で「入手」などを足す)。同じ PR で、空の `next.md`(冒頭の説明と、「変わったこと」「変えていないもの」の見出しだけ)を作り直す
   - README などの「(v<version> から)」は、この PR では外さない(ストアで公開されるまで、ストアの版では使えないため。外すのは 5. の 5)
   - その前に、`extension/store/listing.md`(説明文)が、この版の機能と合っているかを見直す(機械では確かめられない)
   - ストアの画像が古いと、「リリースを作る」が止まる。`extension/` で `npm run build && npm run screenshots` を実行し、作り直した画像と `screenshots.lock` を PR に入れる(ふだんの CI では、古いと注意が出る)
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
- 画像(アイコン・スクリーンショット)を作り直すときだけ、リポジトリ直下で `npm ci && npx playwright install chromium` をしてから `npm run icons` / `npm run screenshots`(画像はコミット済みなので、普段は不要)。`npm run screenshots` は画像の元のファイルの指紋を `extension/store/screenshots.lock` に残し、`npm run check-screenshots` がそれを今の指紋と比べる

## 3. ストアに上げる

### Actions でアップロードする(2 回目以降の版。#134)

「リリースを作る」が、リリースに添えた ZIP をストアにアップロードするところまで行う。**「審査のため送信」は押さない。**

1. 前の版が審査中でないことを確かめる(審査中なら、アップロードの手順は上げずに止まる。審査中の版は差し替えない)
2. 「リリースを作る」を、タグとコミットを入れて起動する(「ストアにアップロードする」はオンのまま)
   - リリースに添えた ZIP を取ってきて、`SHA256SUMS` と合うか、ZIP の `manifest.json` の version がタグと同じかを確かめてから上げる(作り直さない)
   - 下の「準備」の Variables が無ければ、上げずに成功で終わる(ログに「飛ばしました」と出る)
3. ダッシュボードを開き、説明文・画像・プライバシーの回答をこの版に合わせる(下の「ダッシュボードで申請する」の 2〜5。申請用のツールができたら、ツールで入れる)
4. 内容を確かめ、保存してから「審査のため送信」を押す
- アップロードだけ失敗したときは、「リリースを作る」を同じタグで、「アップロードだけする」(`upload_only`)をオンにして起動し直す(リリースは作り直さない)。失敗の文は、Actions のログを Issue に貼れば AI が直す
- 同じ版の ZIP は、ストアが 2 回目を受け付けない

#### 準備(1 回だけ)

鍵ファイルは作らない。GitHub の Actions が、このリポジトリの main から動いたときだけ、Google のサービスアカウントとして入れるようにする(Workload Identity 連携)。GitHub に置くのは識別子だけで、秘密の値は置かない。

1. ストアのデベロッパー アカウントで、2 段階認証を有効にする
2. Google Cloud でプロジェクトを作り、「Chrome Web Store API」を有効にする
3. サービスアカウントを作る(Google Cloud 側のロールは要らない)。メールアドレスを控える
4. ストアのダッシュボードの「アカウント」で、3. のサービスアカウントのメールを足す(足せるのは 1 つだけ)
5. Google Cloud の「Workload Identity 連携」で、プールとプロバイダを作る
   - プロバイダは OIDC。発行元は `https://token.actions.githubusercontent.com`
   - 属性のマッピング: `google.subject=assertion.sub`、`attribute.repository=assertion.repository`、`attribute.ref=assertion.ref`
   - 属性の条件: `assertion.repository=='shibuhachi-works/last-one-click' && assertion.ref=='refs/heads/main'`(このリポジトリの main から動いた workflow だけ)
   - プロバイダのリソース名(`projects/<番号>/locations/global/workloadIdentityPools/<プール>/providers/<プロバイダ>`)を控える
6. 3. のサービスアカウントの「権限」で、`principalSet://iam.googleapis.com/projects/<番号>/locations/global/workloadIdentityPools/<プール>/attribute.repository/shibuhachi-works/last-one-click` に「Workload Identity ユーザー」と「サービス アカウント トークン作成者」を付ける
7. 公開者 ID を控える(ダッシュボードの「パブリッシャー」→「設定」)
8. GitHub のリポジトリの Settings → Secrets and variables → Actions の **Variables** に、次の 3 つを入れる(Secrets ではない。秘密の値ではないため)
   - `CWS_WIF_PROVIDER`(5. のプロバイダのリソース名)
   - `CWS_SERVICE_ACCOUNT`(3. のメール)
   - `CWS_PUBLISHER_ID`(7. の公開者 ID)
   - アイテム ID は `jomapffkhcdpnodaffobmpfofnnaihnd`(ストアの URL の末尾)をコードに持っている

### ダッシュボードで申請する

1. ダッシュボード →(初回は「新しいアイテム」。2 回目以降は、アイテムの「パッケージ」→「新しいパッケージをアップロード」)→ ZIP を上げる。名前を変えた版も、新しいアイテムは作らず、同じアイテムを更新する(ID とストアの URL が変わらない)
2. **ストアの掲載情報**: `extension/store/listing.md` の「基本」「詳細な説明」を貼る。カテゴリは「仕事効率化」、言語は「日本語」
3. **画像**: スクリーンショット `extension/store/screenshot-1.png` 〜 `screenshot-5.png`(1280x800、5 枚とも)を番号順に上げる。可能なら実機で note のエディタに入力された状態も 1 枚撮って足す(記事本文・アカウント名が写らないもの)。小さなプロモタイルは `extension/store/promo-small.png`。動画の欄には `listing.md` の「画像」にある YouTube の URL を入れる
4. **プライバシーへの取り組み**: `listing.md` の「単一の目的」「権限の理由」「リモートコード」「データの使用」をそのまま回答する。プライバシーポリシー URL を入れる
5. **公開設定**: 決済方法は「料金なし」、公開範囲は「公開」(0. の判断どおり)。配布地域はすべて
6. 「審査のため送信」。「審査の合格後に自動的に公開する」を外すと、合格後に自分で公開を押すまで待てる(告知の日に合わせたいとき)

## 4. 審査中・審査後

- 審査は通常 1〜3 日。ホスト権限が付いているので、権限の理由が薄いと差し戻される。差し戻しのメールが来たら、本文を Issue に貼れば AI が回答案と修正 PR を作る
- 公開されたら、ストアの URL を AI に渡す。紹介ページ(portfolio リポジトリ)の `storeUrl` を入れる PR と、`docs/ROADMAP.md` の「Chrome ウェブストアに公開」にチェックを入れる PR を作る
- 版のタグとリリースは、`docs/releases/<タグ名>.md` に本文を置く PR をマージしたあと、Actions の「リリースを作る」を起動して作る(タグ名と、ストアに上げた版のコミットの SHA を入れる)。AI の作業環境からはタグもリリースも直接は作れないので、この workflow を使う。main の先頭なら workflow がタグも作る。古いコミット(main と workflow ファイルが違う)にリリースを作るときは、人が先に `git tag -a <タグ名> <SHA>` → `git push origin <タグ名>` でタグを打ってから起動する(Actions の token では作れない)

## 5. 次に上げ直すとき

1. `manifest.json` の `version` を上げる(例: 0.1.0 → 0.1.1)
2. 前の版が公開されてから、リリースの PR をマージして「リリースを作る」を起動する。ZIP は 3. の「Actions でアップロードする」で上がる(準備が済んでいないときは、リリースに添えた ZIP をダッシュボードの「パッケージ」→「新しいパッケージをアップロード」)。人が説明文・画像・プライバシーの回答を確かめ、保存してから「審査のため送信」を押す
3. 掲載情報・プライバシーの回答に変更があれば `listing.md` を先に直してから画面に反映する
4. ストアで新しい版が公開されたら、`shared/released/selectors-schema.v<版>.ts` を、その版のタグの `shared/selectors-schema.ts` の写しに、`shared/released/note.v<版>.json` を、その版のタグの `selectors/note.json` の写しに置き換える(ファイル名の版と、`shared/selectors-released.test.ts` の import と `RELEASED` も変える)
5. ストアで新しい版が公開されたら、`README.md`・`extension/README.md`・`templates/note/` の「(v<版> から)」を外す(公開の前には外さない)
6. ストアで新しい版が公開されたら、使い方を紹介する公開済みの記事のうち、その版で変わった画面・動きを書いている所を直す(公開の前には直さない。ストアの版を使う読者とずれるため)。探し方: `docs/releases/v<版>.md` の「変わったこと」に出てくるボタン・欄の名前で記事を検索し、画面の画像も見る

## 守ること(AGENTS.md / extension/README と同じ)

- 説明文に「認証情報を扱わない」「公開ボタンは押さない」「非公式ツール」を明記する(listing.md に入っている)
- `host_permissions` を増やさない(増やすと審査が厳しくなる)
- セレクタの修正だけなら、`selectors/note.json` を main に push すれば全ユーザーに届く。ストアの再申請は不要
