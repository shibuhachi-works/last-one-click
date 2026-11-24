// 開発用のビルド(EXTRA_SITE=1 npm run build)で、dist/manifest.json に追加の対応先の権限を足す(#118)。
// ふつうのビルド・ストアに出す ZIP(npm run package)では使わない。足すものは shared/manifest-permissions.test.ts で固定する

/** shared/extra-site.ts の EXTRA_SITE_ORIGIN と同じ(テストで確かめる) */
export const EXTRA_SITE_ORIGIN = "https://library.libecity.com/*";
/** 開発用のビルドで足す permissions(入れるときの警告が出ない) */
export const EXTRA_SITE_PERMISSIONS = ["activeTab", "scripting"];

/** 開発用のビルドにするか。EXTRA_SITE=1 のときだけ */
export function isExtraSiteBuild(env) {
  return env.EXTRA_SITE === "1";
}

/** manifest に追加の対応先の権限を足した写しを返す(元は変えない)。host_permissions には足さない */
export function withExtraSite(manifest) {
  const permissions = [...manifest.permissions];
  for (const p of EXTRA_SITE_PERMISSIONS) if (!permissions.includes(p)) permissions.push(p);
  const optional = [...(manifest.optional_host_permissions ?? [])];
  if (!optional.includes(EXTRA_SITE_ORIGIN)) optional.push(EXTRA_SITE_ORIGIN);
  return {
    ...manifest,
    // chrome://extensions で開発用のビルドだと分かるように(version は変えない)
    version_name: `${manifest.version} 開発用`,
    permissions,
    optional_host_permissions: optional,
  };
}
