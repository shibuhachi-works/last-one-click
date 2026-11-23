// 追加の対応先(shared/extra-site.ts)を chrome の API につなぐ。ポップアップと service worker の両方から使う
import {
  EXTRA_SITE_EDITOR_PROBE,
  EXTRA_SITE_ORIGIN,
  EXTRA_SITE_SCRIPT_FILE,
  EXTRA_SITE_SCRIPT_ID,
  probeEditor,
  type ExtraSiteApi,
} from "../../../shared/extra-site";

const origins = { origins: [EXTRA_SITE_ORIGIN] };

export const chromeExtraSiteApi: ExtraSiteApi = {
  hasPermission: () => chrome.permissions.contains(origins),
  requestPermission: () => chrome.permissions.request(origins),
  removePermission: () => chrome.permissions.remove(origins),
  isRegistered: async () => (await chrome.scripting.getRegisteredContentScripts({ ids: [EXTRA_SITE_SCRIPT_ID] })).length > 0,
  register: () =>
    chrome.scripting.registerContentScripts([
      { id: EXTRA_SITE_SCRIPT_ID, matches: [EXTRA_SITE_ORIGIN], js: [EXTRA_SITE_SCRIPT_FILE], runAt: "document_idle" },
    ]),
  unregister: () => chrome.scripting.unregisterContentScripts({ ids: [EXTRA_SITE_SCRIPT_ID] }),
  // activeTab で、ツールバーのアイコンを押したタブにだけ入れる。読むだけの関数を 1 回動かす
  probe: async (tabId) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: probeEditor, args: [EXTRA_SITE_EDITOR_PROBE] });
    return r?.result === true;
  },
};
