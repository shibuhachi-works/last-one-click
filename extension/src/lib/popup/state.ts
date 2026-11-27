// ポップアップの、開いているあいだだけ持つ状態(popup.ts から分けた。保存はしない)。
// いくつものファイルの関数が読み書きするので、1 つのオブジェクトにまとめる。
import type { CurrentUser } from "../../../../shared/current-user";
import type { ExtraSiteOffer } from "../../../../shared/extra-site";

export const state = {
  /** 手元の md と一緒にドロップされた、本文の画像(md に ![説明](ファイル名) で書いてあるもの) */
  bodyImageFiles: [] as File[],
  /** 記事のフォルダ・ZIP のとき、本文に書いた参照先(相対パス)ごとの画像 */
  bodyImagesBySrc: new Map<string, File>(),
  /** GitHub から読んだ場合の、相対 thumbnail の基準 */
  baseUrl: undefined as string | undefined,
  /** ポップアップを開いたときに読めた、ログイン中のアカウント(#106)。この画面に出すためだけに持つ(保存しない) */
  loggedInAccount: null as CurrentUser | null,
  /** 読み込んだ記事の front matter の note_account(#102)。無ければ undefined */
  articleNoteAccount: undefined as string | undefined,
  /** 案内の種類(エディタか、それ以外の追加の対応先のページか)。許可したあとの知らせの文を変える */
  extraSiteOffer: null as ExtraSiteOffer,
  /** 下書きを入れる追加の対応先のタブ(今のタブがその編集画面のときだけ。それ以外は note のタブを開く) */
  extraSiteFillTabId: undefined as number | undefined,
  /** 今のタブが追加の対応先のページか(編集画面でなくてもよい)。md を入れる前のアカウントの出し分けに使う(#201) */
  onExtraSitePage: false,
  /**
   * 書き換える note の記事(#174)。今のタブが、すでにある記事の編集画面(/notes/<ID>/edit)のときだけ。
   * そのときは主のボタンを「この記事を書き換える」にし、「新しい下書きとして作る」も出す
   */
  rewriteTarget: undefined as { tabId: number; key: string; title: string } | undefined,
  /** 追加の対応先の許可があるか(showExtraSiteSetting で決まる) */
  extraSiteGranted: false,
  /** 追加の対応先のアカウントを出せたか(読めたときだけ true) */
  extraSiteAccountShown: false,
  /** 追加の対応先のアカウントを、もう聞いたか(1 回だけ聞く) */
  extraSiteAccountAsked: false,
  /** 前に出した「target が合わない」の知らせ。合うようになったら、この知らせだけ消す */
  targetProblemShown: null as string | null,
  /** 下書きを作るボタン(#submit)で、組み立て・送り出しをしている途中か */
  submitting: false,
  /** 診断の「コピー」を「コピーしました ✓」から戻すタイマー */
  copiedTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  /** ドロップ領域に出す、受け取り済みの md のファイル名 */
  pickedMdName: "",
};
