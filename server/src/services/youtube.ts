import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Vod } from '../../../shared/types/api.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class YoutubeFetchValidationError extends Error {}

export class YoutubeFetchError extends Error {}

const getStreamsUrl = (channelURL: string) => {
  let url: URL
  try {
    url = new URL(channelURL)
  } catch {
    throw new YoutubeFetchValidationError('Enter a valid YouTube channel URL.')
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    (url.hostname !== 'youtube.com' && !url.hostname.endsWith('.youtube.com')) ||
    url.username ||
    url.password
  ) {
    throw new YoutubeFetchValidationError('VODs can only be fetched from YouTube channel URLs.')
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const tabNames = new Set(['videos', 'streams', 'shorts', 'live', 'featured', 'playlists'])
  if (segments.length > 0 && tabNames.has(segments[segments.length - 1].toLowerCase())) segments.pop()
  if (segments.length === 0) {
    throw new YoutubeFetchValidationError('Enter a YouTube channel URL, not the YouTube home page.')
  }

  url.protocol = 'https:'
  url.hostname = 'www.youtube.com'
  url.port = ''
  url.pathname = `/${segments.join('/')}/streams`
  url.search = ''
  url.hash = ''
  return url.toString()
}

const getDatetime = (entry: Record<string, unknown>) => {
  const timestamp = entry.release_timestamp ?? entry.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    const date = new Date(timestamp * 1000)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  for (const dateValue of [entry.upload_date, entry.release_date]) {
    if (typeof dateValue !== 'string') continue
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(dateValue)
    const date = match
      ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`)
      : new Date(dateValue)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  return ''
}

const toVod = (entry: unknown): Vod | null => {
  if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) return null

  const thumbnail = typeof entry.thumbnail === 'string'
    ? entry.thumbnail
    : Array.isArray(entry.thumbnails)
      ? [...entry.thumbnails].reverse().find((item) => isRecord(item) && typeof item.url === 'string')?.url
      : undefined

  return {
    videoID: entry.id,
    videoURL: `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`,
    datetime: getDatetime(entry),
    vodTitle: typeof entry.title === 'string' && entry.title ? entry.title : entry.id,
    thumbnailURL: typeof thumbnail === 'string' ? thumbnail : `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
  }
}

const runYtDlp = (
  url: string,
  onVideoMetadata: (count: number, vod: Vod) => void,
) => new Promise<Vod[]>((resolve, reject) => {
  const child = spawn(
    'yt-dlp',
    ['--dump-json', '--no-warnings', '--skip-download', url],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const vods: Vod[] = []
  let stderr = ''
  let settled = false

  const timeout = setTimeout(() => {
    child.kill()
    fail(new YoutubeFetchError('yt-dlp timed out while retrieving channel metadata.'))
  }, 120_000)

  const fail = (error: Error) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    reject(error)
  }

  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    if (settled || !line.trim()) return

    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      child.kill()
      fail(new YoutubeFetchError('yt-dlp returned invalid video metadata.'))
      return
    }

    const vod = toVod(entry)
    if (vod) {
      vods.push(vod)
      onVideoMetadata(vods.length, vod)
    }
  })

  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-4000)
  })

  child.once('error', (error) => {
    const code = isRecord(error) ? error.code : undefined
    if (code === 'ENOENT') {
      fail(new YoutubeFetchError('yt-dlp is required on the server and must be available on PATH.'))
      return
    }
    fail(new YoutubeFetchError(`Could not start yt-dlp: ${error.message}`))
  })

  child.once('close', (code) => {
    if (settled) return
    if (code !== 0) {
      const details = stderr.trim().slice(-2000)
      fail(new YoutubeFetchError(`yt-dlp could not fetch this channel.${details ? ` ${details}` : ` Exit code ${code}.`}`))
      return
    }

    settled = true
    clearTimeout(timeout)
    resolve(vods)
  })
})

export async function fetchYoutubeVods(
  channelURL: string,
  onVideoMetadata: (count: number, vod: Vod) => void = () => undefined,
): Promise<Vod[]> {
  return runYtDlp(getStreamsUrl(channelURL), onVideoMetadata)
}
