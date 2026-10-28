import { File } from 'expo-file-system'
import type {
  MobileWebBundleFetchProgress,
  MobileWebBundleFetchResult
} from '../transport/mobile-web-bundle-fetch'
import {
  MobileWebBundleManifestReadSchema,
  type MobileWebBundleManifestRead
} from '../transport/mobile-web-bundle-reply-schemas'

/**
 * Orca Voice fork: the page bundle built into this APK, served in place of the desktop's.
 *
 * `voice/build-apk.ps1` builds the page from the same source as this shell (the commit of the
 * desktop release it is paired with) and copies the tree into the Android assets under this
 * directory: `manifest.json` plus every asset at its manifest path. The manifest is parsed with the
 * same schema as a desktop's, which recomputes the build id from the asset list, so a tree that
 * does not match its manifest is refused rather than served.
 *
 * Triple slash on purpose: `asset://voice-page/…` would read `voice-page` as the URI's host.
 */
const EMBEDDED_ROOT = 'asset:///voice-page/'

function embeddedFile(path: string): File {
  return new File(`${EMBEDDED_ROOT}${path}`)
}

let manifestRead: Promise<MobileWebBundleManifestRead | null> | null = null

/** The built-in manifest, or null when this build carries none or it does not parse. */
export function readEmbeddedManifest(): Promise<MobileWebBundleManifestRead | null> {
  manifestRead ??= (async () => {
    try {
      const raw: unknown = JSON.parse(await embeddedFile('manifest.json').text())
      return MobileWebBundleManifestReadSchema.parse(raw)
    } catch {
      return null
    }
  })()
  return manifestRead
}

/** The whole built-in bundle in the shape a desktop download produces, ready for the store. */
export async function fetchEmbeddedBundle(
  onProgress?: (progress: MobileWebBundleFetchProgress) => void
): Promise<MobileWebBundleFetchResult> {
  const startedAt = Date.now()
  const manifest = await readEmbeddedManifest()
  if (manifest === null) {
    throw new Error('this build carries no built-in page')
  }
  const assets = new Map<string, Uint8Array>()
  let receivedBytes = 0
  for (const asset of manifest.assets) {
    const bytes = await embeddedFile(asset.path).bytes()
    if (bytes.byteLength !== asset.byteLength) {
      throw new Error(
        `built-in page asset ${asset.path} is ${bytes.byteLength} bytes, not ${asset.byteLength}`
      )
    }
    assets.set(asset.path, bytes)
    receivedBytes += bytes.byteLength
    onProgress?.({
      completedAssets: assets.size,
      totalAssets: manifest.assets.length,
      receivedBytes,
      totalBytes: manifest.totalBytes
    })
  }
  return {
    manifest,
    assets,
    reused: [],
    totalBytes: manifest.totalBytes,
    elapsedMs: Date.now() - startedAt
  }
}
