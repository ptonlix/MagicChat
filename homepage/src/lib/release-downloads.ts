type ReleasePlatform =
  | 'android'
  | 'ios'
  | 'linux-amd'
  | 'macos'
  | 'windows';

type ReleaseManifestEntry = {
  url?: unknown;
};

type ReleaseManifest = Partial<Record<ReleasePlatform, ReleaseManifestEntry>>;

const RELEASE_MANIFEST_URL = 'https://jiying.chat/releases/version.json';
const RELEASE_LINK_SELECTOR = 'a[data-release-platform]';

function isReleasePlatform(value: string | undefined): value is ReleasePlatform {
  return value === 'android'
    || value === 'ios'
    || value === 'linux-amd'
    || value === 'macos'
    || value === 'windows';
}

function releaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export async function hydrateReleaseDownloadLinks(
  root: ParentNode = document,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>(RELEASE_LINK_SELECTOR));
  if (links.length === 0) return;

  try {
    const response = await fetcher(RELEASE_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) return;

    const manifest = await response.json() as ReleaseManifest;
    for (const link of links) {
      const platform = link.dataset.releasePlatform;
      if (!isReleasePlatform(platform)) continue;

      const url = releaseUrl(manifest[platform]?.url);
      if (url) link.href = url;
    }
  } catch {
    // Keep the stable fallback href values when the manifest is unavailable.
  }
}
