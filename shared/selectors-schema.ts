// selectors/*.json の形の検査。拡張(GitHub から取る)と Playwright 版(ローカルで読む)で共通。
//
// GitHub の main を変えられる人は、この JSON で拡張の動きを変えられる。
// だから「どの URL を開くか」「どんな正規表現を使うか」は、使う前に必ずここで確かめる。
// 「どのボタンを押すか」の守りは shared/forbidden-click.ts が別に持つ。

/** 拡張が新しいタブで開いてよい origin。ここ以外は同梱の値に戻す */
export const ALLOWED_NOTE_ORIGINS: readonly string[] = ["https://note.com", "https://editor.note.com"];

const MAX_SELECTOR_LEN = 2000;
const MAX_TEXT_LEN = 100;
const MAX_PATTERN_LEN = 200;

export type SelectorsJson = {
  version: number;
  newNoteUrl: string;
  loginUrlPattern: string;
  title: string;
  body: string;
  thumbnail: {
    fileInput: string;
    addButton: string;
    addButtonText: string[];
    /** 見出し画像のボタンを押して出るメニューの「画像をアップロード」の文字。省略時は ["画像をアップロード"] */
    uploadMenuText: string[];
    confirmText: string[];
  };
  openPublishSettingsText: string[];
  publishSettings: {
    hashtagInput: string;
    magazineToggleText: string[];
    magazineItem: string;
    /** マガジン名の行にある「追加」ボタンの文字。省略時は ["追加"] */
    magazineAddButtonText: string[];
    publishButtonText: string[];
    /** 記事タイプの「有料」のラジオ(実機では隠れている。押すのは、これに付いた label)。省略時は DEFAULT_PAID.paidRadio */
    paidRadio: string;
    /** 記事タイプの「有料」の label の文字。label がこれと違えば押さない。省略時は ["有料"] */
    paidLabelText: string[];
    /** 「有料」を選んだあとに出る価格の欄。省略時は DEFAULT_PAID.priceInput */
    priceInput: string;
    /**
     * 「有料」を選ぶと、右上のボタンが「投稿する」からこれに変わる。★ 押さない ★(有料エリアは人が決める)。
     * 公開設定の画面かどうかを確かめるのにだけ使う。省略時は ["有料エリア設定"]
     */
    paidAreaButtonText: string[];
    /**
     * 「有料エリア設定」を押した先の本文(編集できない ProseMirror)。この直下に、本文のブロックと widget が交互に並ぶ。
     * 省略時は DEFAULT_PAYWALL.paywallContainer
     */
    paywallContainer: string;
    /** ブロックとブロックの間の部品(中に「ラインをこの場所に変更」がある)。省略時は DEFAULT_PAYWALL.paywallWidget */
    paywallWidget: string;
    /** widget の中の、押すとその位置にラインを動かすボタンの文字。省略時は ["ラインをこの場所に変更"] */
    paywallChangeButtonText: string[];
    /** いまのライン(「このラインより先を有料にする」)。押さない。ラインが動いたかを確かめるのに使う。省略時は "#paywall-line" */
    paywallLine: string;
  };
  /**
   * 本文の先頭に目次を入れるときに押すもの(note のエディタの「+」→「目次」)。
   * 省略時は下の DEFAULT_TOC。目次はカーソルのある行の次の行に入る(2026-11-10 実機)
   */
  toc: {
    /** 本文の行の左に出る「+」(メニューを開く)のボタン */
    openMenuButton: string;
    /** メニューの中の「目次」のボタン */
    itemSelector: string;
    /** itemSelector で見つからないときに文字で探す */
    itemText: string[];
  };
  /**
   * ログイン中のアカウントを読む問い合わせ(#106)。名前とアイコンを画面に出すためだけに使う。省略時は下の DEFAULT_ACCOUNT。
   * note が URL や応答の形を変えたら、ここを直せば追従できる
   */
  account: {
    /** ログイン中のユーザーの情報を返す URL(GET だけ)。"/" で始まるときは、開いている note のページの origin に付ける */
    currentUserUrl: string;
    /** 応答の JSON の中の、表示名の道筋("data.nickname" の形)。前から順に見て、最初に読めたものを使う */
    namePaths: string[];
    /** note の ID(note.com/<ID>)の道筋 */
    idPaths: string[];
    /** アイコンの画像の URL の道筋 */
    iconPaths: string[];
  };
};

/** selectors の toc を省略したときの値(2026-11-10 に note のエディタの診断レポートで確認) */
export const DEFAULT_TOC: SelectorsJson["toc"] = {
  openMenuButton: 'button[aria-label="メニューを開く"]',
  itemSelector: "#toc-setting",
  itemText: ["目次"],
};

/**
 * selectors の有料記事の部品を省略したときの値(2026-11-16 に公開設定の画面の診断レポートで確認)。
 * ストアに出ている版も main の selectors/note.json を読むので、これらは足すだけにして、省略できるようにする
 */
export const DEFAULT_PAID: { readonly paidRadio: string; readonly paidLabelText: readonly string[]; readonly priceInput: string; readonly paidAreaButtonText: readonly string[] } = {
  paidRadio: 'input#paid[name="is_paid"]',
  paidLabelText: ["有料"],
  priceInput: "input#price",
  paidAreaButtonText: ["有料エリア設定"],
};

/**
 * selectors の有料エリアの部品を省略したときの値(2026-11-16 に「有料エリア設定」の画面の診断レポートで確認)。
 * DEFAULT_PAID と同じく、足すだけにして省略できるようにする
 */
export const DEFAULT_PAYWALL: {
  readonly paywallContainer: string;
  readonly paywallWidget: string;
  readonly paywallChangeButtonText: readonly string[];
  readonly paywallLine: string;
} = {
  paywallContainer: ".ProseMirror.paywall-setting",
  paywallWidget: ".ProseMirror-widget",
  paywallChangeButtonText: ["ラインをこの場所に変更"],
  paywallLine: "#paywall-line",
};

/**
 * selectors の account を省略したときの値(#106)。ストアに出ている版も main の selectors/note.json を読むので、
 * account は足すだけにして、省略できるようにする。応答の形は実機で確かめる(人の作業)
 */
export const DEFAULT_ACCOUNT: {
  readonly currentUserUrl: string;
  readonly namePaths: readonly string[];
  readonly idPaths: readonly string[];
  readonly iconPaths: readonly string[];
} = {
  currentUserUrl: "https://note.com/api/v2/current_user",
  namePaths: ["data.nickname", "data.name"],
  idPaths: ["data.urlname"],
  iconPaths: ["data.profile_image_path", "data.user_profile_image_path", "data.profileImagePath"],
};

/** account の道筋の形(英数字と _ のキーを . でつなぐ) */
const ACCOUNT_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/;
/** account の道筋の候補の数の上限 */
const MAX_ACCOUNT_PATHS = 10;

export class SelectorsValidationError extends Error {
  constructor(message: string) {
    super(`selectors の形が不正です: ${message}`);
    this.name = "SelectorsValidationError";
  }
}

function fail(msg: string): never {
  throw new SelectorsValidationError(msg);
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`${name} はオブジェクトである必要があります`);
  return v as Record<string, unknown>;
}

function str(v: unknown, name: string, max = MAX_SELECTOR_LEN): string {
  if (typeof v !== "string" || v.trim() === "") fail(`${name} は空でない文字列である必要があります`);
  if (v.length > max) fail(`${name} が長すぎます(${v.length} > ${max})`);
  return v;
}

function strList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length === 0) fail(`${name} は空でない文字列の配列である必要があります`);
  return v.map((s, i) => str(s, `${name}[${i}]`, MAX_TEXT_LEN));
}

/** 開いてよい note の URL か(https で、origin が許可リストにある) */
export function isAllowedNoteUrl(url: string): boolean {
  try {
    return ALLOWED_NOTE_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * JSON を検査して、型の付いた値を返す。通らなければ SelectorsValidationError。
 * 呼び出し側は、GitHub から取った値が通らなければ同梱の値に戻す。
 */
export function validateSelectorsJson(input: unknown): SelectorsJson {
  const o = obj(input, "selectors");

  if (typeof o.version !== "number" || !Number.isInteger(o.version) || o.version < 1) fail("version は 1 以上の整数");

  const newNoteUrl = str(o.newNoteUrl, "newNoteUrl", 300);
  if (!isAllowedNoteUrl(newNoteUrl)) fail(`newNoteUrl は ${ALLOWED_NOTE_ORIGINS.join(" / ")} のどれかで始まる必要があります: ${newNoteUrl}`);

  const loginUrlPattern = str(o.loginUrlPattern, "loginUrlPattern", MAX_PATTERN_LEN);
  try {
    new RegExp(loginUrlPattern);
  } catch {
    fail("loginUrlPattern が正規表現として不正");
  }

  const t = obj(o.thumbnail, "thumbnail");
  const p = obj(o.publishSettings, "publishSettings");
  const toc = o.toc === undefined ? undefined : obj(o.toc, "toc");
  const account = o.account === undefined ? undefined : obj(o.account, "account");

  return {
    version: o.version,
    newNoteUrl,
    loginUrlPattern,
    title: str(o.title, "title"),
    body: str(o.body, "body"),
    thumbnail: {
      fileInput: str(t.fileInput, "thumbnail.fileInput"),
      addButton: str(t.addButton, "thumbnail.addButton"),
      addButtonText: strList(t.addButtonText, "thumbnail.addButtonText"),
      uploadMenuText: t.uploadMenuText === undefined ? ["画像をアップロード"] : strList(t.uploadMenuText, "thumbnail.uploadMenuText"),
      confirmText: strList(t.confirmText, "thumbnail.confirmText"),
    },
    openPublishSettingsText: strList(o.openPublishSettingsText, "openPublishSettingsText"),
    publishSettings: {
      hashtagInput: str(p.hashtagInput, "publishSettings.hashtagInput"),
      magazineToggleText: strList(p.magazineToggleText, "publishSettings.magazineToggleText"),
      magazineItem: str(p.magazineItem, "publishSettings.magazineItem"),
      magazineAddButtonText:
        p.magazineAddButtonText === undefined ? ["追加"] : strList(p.magazineAddButtonText, "publishSettings.magazineAddButtonText"),
      publishButtonText: strList(p.publishButtonText, "publishSettings.publishButtonText"),
      paidRadio: p.paidRadio === undefined ? DEFAULT_PAID.paidRadio : str(p.paidRadio, "publishSettings.paidRadio"),
      paidLabelText: p.paidLabelText === undefined ? [...DEFAULT_PAID.paidLabelText] : strList(p.paidLabelText, "publishSettings.paidLabelText"),
      priceInput: p.priceInput === undefined ? DEFAULT_PAID.priceInput : str(p.priceInput, "publishSettings.priceInput"),
      paidAreaButtonText:
        p.paidAreaButtonText === undefined ? [...DEFAULT_PAID.paidAreaButtonText] : strList(p.paidAreaButtonText, "publishSettings.paidAreaButtonText"),
      paywallContainer:
        p.paywallContainer === undefined ? DEFAULT_PAYWALL.paywallContainer : str(p.paywallContainer, "publishSettings.paywallContainer"),
      paywallWidget: p.paywallWidget === undefined ? DEFAULT_PAYWALL.paywallWidget : str(p.paywallWidget, "publishSettings.paywallWidget"),
      paywallChangeButtonText:
        p.paywallChangeButtonText === undefined
          ? [...DEFAULT_PAYWALL.paywallChangeButtonText]
          : strList(p.paywallChangeButtonText, "publishSettings.paywallChangeButtonText"),
      paywallLine: p.paywallLine === undefined ? DEFAULT_PAYWALL.paywallLine : str(p.paywallLine, "publishSettings.paywallLine"),
    },
    toc: toc
      ? {
          openMenuButton: str(toc.openMenuButton, "toc.openMenuButton"),
          itemSelector: str(toc.itemSelector, "toc.itemSelector"),
          itemText: strList(toc.itemText, "toc.itemText"),
        }
      : { ...DEFAULT_TOC, itemText: [...DEFAULT_TOC.itemText] },
    account: {
      currentUserUrl: account?.currentUserUrl === undefined ? DEFAULT_ACCOUNT.currentUserUrl : currentUserUrl(account.currentUserUrl),
      namePaths: account?.namePaths === undefined ? [...DEFAULT_ACCOUNT.namePaths] : accountPaths(account.namePaths, "account.namePaths"),
      idPaths: account?.idPaths === undefined ? [...DEFAULT_ACCOUNT.idPaths] : accountPaths(account.idPaths, "account.idPaths"),
      iconPaths: account?.iconPaths === undefined ? [...DEFAULT_ACCOUNT.iconPaths] : accountPaths(account.iconPaths, "account.iconPaths"),
    },
  };
}

/**
 * ログイン中のユーザーの問い合わせ先。note の origin(https)の /api/ の下だけを許す
 * ("/" で始まる書き方は、開いている note のページの origin に付く。どちらも許可リストの origin になる)
 */
function currentUserUrl(v: unknown): string {
  const s = str(v, "account.currentUserUrl", 300);
  let u: URL;
  try {
    u = new URL(s, "https://note.com");
  } catch {
    fail("account.currentUserUrl が URL として不正");
  }
  if (!s.startsWith("/") && !isAllowedNoteUrl(s)) fail(`account.currentUserUrl は ${ALLOWED_NOTE_ORIGINS.join(" / ")} のどれかで始まる必要があります: ${s}`);
  if (s.startsWith("//")) fail("account.currentUserUrl は // で始められません");
  if (!u.pathname.startsWith("/api/")) fail(`account.currentUserUrl は /api/ の下である必要があります: ${s}`);
  return s;
}

function accountPaths(v: unknown, name: string): string[] {
  const list = strList(v, name);
  if (list.length > MAX_ACCOUNT_PATHS) fail(`${name} が多すぎます(${list.length} > ${MAX_ACCOUNT_PATHS})`);
  list.forEach((p, i) => {
    if (!ACCOUNT_PATH.test(p)) fail(`${name}[${i}] は "data.nickname" の形である必要があります: ${p}`);
  });
  return list;
}
