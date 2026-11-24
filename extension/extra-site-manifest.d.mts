// extra-site-manifest.mjs の型(shared/manifest-permissions.test.ts から読むため)
export const EXTRA_SITE_ORIGIN: string;
export const EXTRA_SITE_PERMISSIONS: string[];
export function isExtraSiteBuild(env: Record<string, string | undefined>): boolean;
export function withExtraSite<T extends { version: string; permissions: string[]; optional_host_permissions?: string[] }>(
  manifest: T,
): T & { version_name: string; optional_host_permissions: string[] };
