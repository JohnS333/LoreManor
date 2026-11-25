import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoreEvent, Vod } from '../../../shared/types/api.js'
import { loadCollection, saveCollection, validateProjectDirectory } from './persistence.js'

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const EVENT_TIMESTAMP_PATTERN = /^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/
const PROMPT_PATH = fileURLToPath(new URL('../prompts/transcriptToEvents.txt', import.meta.url))
// Flash-Lite is intended for high-throughput work and is more cost-effective
// for deterministic transcript-to-JSON extraction than the larger Flash model.
const GEMINI_MODEL = 'gemini-3.5-flash-lite'

type EventLogger = (message: string) => void

type CandidateEvent = {
  starttime: string
  endtime: string
  description: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error

export class EventExtractionValidationError extends Error {}

export class EventExtractionError extends Error {}

type EventExtractionResult = {
  events: LoreEvent[]
  transcriptReused: boolean
}

const validateVod = (value: unknown): Vod => {
  if (
    !isRecord(value) ||
    typeof value.videoID !== 'string' ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(value.videoID) ||
    typeof value.videoURL !== 'string' ||
    typeof value.datetime !== 'string' ||
    typeof value.vodTitle !== 'string' ||
    typeof value.thumbnailURL !== 'string'
  ) {
    throw new EventExtractionValidationError('vod must be a valid VOD object.')
  }

  let url: URL
  try {
    url = new URL(value.videoURL)
  } catch {
    throw new EventExtractionValidationError('vod.videoURL must be a valid YouTube video URL.')
  }

  if (
    url.protocol !== 'https:' ||
    !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new EventExtractionValidationError('vod.videoURL must be a valid YouTube video URL.')
  }

  const urlVideoId = url.hostname === 'youtu.be'
    ? url.pathname.slice(1).split('/')[0]
    : url.searchParams.get('v')
  if (urlVideoId !== value.videoID) {
    throw new EventExtractionValidationError('vod.videoID must match the video ID in vod.videoURL.')
  }

  return value as Vod
}

const getVideoUrl = (vod: Vod) => vod.videoURL

const runYtDlp = (videoURL: string, outputTemplate: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(
    'yt-dlp',
    [
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'en',
      '--sub-format',
      'vtt/best',
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--output',
      outputTemplate,
      videoURL,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  )

  let stderr = ''
  let settled = false
  const timeout = setTimeout(() => {
    child.kill()
    fail(new EventExtractionError('yt-dlp timed out while fetching the VOD transcript.'))
  }, 120_000)

  const fail = (error: Error) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    reject(error)
  }

  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-4000)
  })

  child.once('error', (error) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      fail(new EventExtractionError('yt-dlp is required on the server and must be available on PATH.'))
      return
    }
    fail(new EventExtractionError(`Could not start yt-dlp: ${error.message}`))
  })

  child.once('close', (code) => {
    if (settled) return
    if (code !== 0) {
      const details = stderr.trim().slice(-2000)
      fail(new EventExtractionError(`yt-dlp could not fetch this transcript.${details ? ` ${details}` : ` Exit code ${code}.`}`))
      return
    }

    settled = true
    clearTimeout(timeout)
    resolve()
  })
})

const fetchTranscript = async (
  projectDirectory: string,
  vod: Vod,
  log: EventLogger,
): Promise<{ transcript: string; reused: boolean }> => {
  const transcriptPath = path.win32.join(projectDirectory, `${vod.videoID}.vtt`)
  try {
    const transcript = await readFile(transcriptPath, 'utf8')
    if (transcript.trim()) {
      log(`Reusing cached transcript ${vod.videoID}.vtt.`)
      return { transcript, reused: true }
    }
    log(`Cached transcript ${vod.videoID}.vtt is empty; fetching a replacement.`)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    log(`No cached transcript found for ${vod.videoID}.`)
  }

  const stagingDirectory = await mkdtemp(path.win32.join(projectDirectory, `.transcript-${vod.videoID}-`))
  const outputTemplate = path.win32.join(stagingDirectory, `${vod.videoID}.%(ext)s`)
  try {
    log('Running yt-dlp to fetch English subtitles.')
    await runYtDlp(getVideoUrl(vod), outputTemplate)
    const files = await readdir(stagingDirectory)
    const transcriptFileName = files.find((fileName) =>
      fileName.startsWith(`${vod.videoID}.`) && fileName.endsWith('.vtt'),
    )
    if (!transcriptFileName) {
      throw new EventExtractionError('yt-dlp completed but no English VTT transcript was available for this VOD.')
    }

    const stagedTranscriptPath = path.win32.join(stagingDirectory, transcriptFileName)
    const stagedStats = await stat(stagedTranscriptPath)
    if (!stagedStats.isFile() || stagedStats.size === 0) {
      throw new EventExtractionError('yt-dlp produced an empty transcript file.')
    }

    const transcript = await readFile(stagedTranscriptPath, 'utf8')
    await unlink(transcriptPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    })
    await rename(stagedTranscriptPath, transcriptPath)
    log(`Transcript saved successfully as ${vod.videoID}.vtt.`)
    return { transcript, reused: false }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
  }
}

const timestampToMilliseconds = (timestamp: string) => {
  const match = EVENT_TIMESTAMP_PATTERN.exec(timestamp)
  if (!match) return null
  const [, hours, minutes, seconds, milliseconds] = match
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(milliseconds)
}

const parseCandidateEvents = (value: unknown): CandidateEvent[] => {
  if (!Array.isArray(value)) {
    throw new EventExtractionError('Gemini returned a response that was not a JSON event array.')
  }

  return value.map((event, index) => {
    if (
      !isRecord(event) ||
      typeof event.starttime !== 'string' ||
      typeof event.endtime !== 'string' ||
      typeof event.Description !== 'string' ||
      !event.Description.trim()
    ) {
      throw new EventExtractionError(`Gemini returned an invalid event at position ${index + 1}.`)
    }

    const startMilliseconds = timestampToMilliseconds(event.starttime)
    const endMilliseconds = timestampToMilliseconds(event.endtime)
    if (startMilliseconds === null || endMilliseconds === null || endMilliseconds <= startMilliseconds) {
      throw new EventExtractionError(`Gemini returned invalid timestamps for event ${index + 1}.`)
    }

    return {
      starttime: event.starttime,
      endtime: event.endtime,
      description: event.Description.trim(),
    }
  }).sort((first, second) =>
    (timestampToMilliseconds(first.starttime) ?? 0) - (timestampToMilliseconds(second.starttime) ?? 0),
  )
}

const readGeminiText = async (prompt: string, apiKey: string): Promise<string> => {
  let response: Response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(180_000),
      },
    )
  } catch (error) {
    throw new EventExtractionError(
      error instanceof Error ? `Gemini request failed: ${error.message}` : 'Gemini request failed.',
    )
  }

  if (!response.ok) {
    const details = (await response.text()).slice(0, 1000)
    throw new EventExtractionError(
      `Gemini API returned HTTP ${response.status}.${details ? ` ${details}` : ''}`,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new EventExtractionError('Gemini returned an invalid JSON response.')
  }

  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new EventExtractionError('Gemini response did not contain any candidates.')
  }
  const firstCandidate = payload.candidates[0]
  if (!isRecord(firstCandidate) || !isRecord(firstCandidate.content) || !Array.isArray(firstCandidate.content.parts)) {
    throw new EventExtractionError('Gemini response did not contain generated event text.')
  }
  const firstPart = firstCandidate.content.parts[0]
  if (!isRecord(firstPart) || typeof firstPart.text !== 'string') {
    throw new EventExtractionError('Gemini response did not contain generated event text.')
  }

  return firstPart.text
}

const getEventDatetime = (vodDatetime: string, starttime: string): string | null => {
  const startMilliseconds = timestampToMilliseconds(starttime)
  const vodStart = Date.parse(vodDatetime)
  if (startMilliseconds === null || !Number.isFinite(vodStart)) return null
  return new Date(vodStart + startMilliseconds).toISOString()
}

const createLoreEvents = (videoID: string, vodDatetime: string, candidates: CandidateEvent[]): LoreEvent[] =>
  candidates.map((event, index) => ({
    eventID: `${videoID}_${String(index + 1).padStart(4, '0')}`,
    sourceType: 'VOD',
    vodId: videoID,
    datetime: getEventDatetime(vodDatetime, event.starttime),
    starttime: event.starttime,
    endtime: event.endtime,
    description: event.description,
    shortsViable: null,
    allocatedTracks: [],
    projectAllocations: [],
  }))

export async function extractEventsForVod(
  projectDirectoryInput: unknown,
  vodInput: unknown,
  apiKeyInput: unknown,
  log: EventLogger,
): Promise<EventExtractionResult> {
  log('Validating project directory, VOD object, and Gemini API key.')
  const projectDirectory = await validateProjectDirectory(projectDirectoryInput)
  const vod = validateVod(vodInput)
  if (typeof apiKeyInput !== 'string' || !apiKeyInput.trim()) {
    throw new EventExtractionValidationError('A Gemini API key is required. Add it in Settings.')
  }
  const apiKey = apiKeyInput.trim()

  log('Checking the project folder for an existing transcript.')
  const { transcript, reused: transcriptReused } = await fetchTranscript(projectDirectory, vod, log)

  log('Reading transcriptToEvents.txt.')
  const template = await readFile(PROMPT_PATH, 'utf8')
  const prompt = template
    .replaceAll('[TRANSCRIPT_FILE]', transcript)
    .replaceAll('[VOD_URL]', vod.videoURL)
    .replaceAll('[VOD_START_DATETIME]', vod.datetime || 'unavailable')

  log(`Sending transcript to Gemini (${GEMINI_MODEL}).`)
  const generatedText = await readGeminiText(prompt, apiKey)
  let generatedEvents: unknown
  try {
    generatedEvents = JSON.parse(generatedText)
  } catch {
    throw new EventExtractionError('Gemini did not return valid JSON. The events were not saved.')
  }
  const extractedEvents = createLoreEvents(vod.videoID, vod.datetime, parseCandidateEvents(generatedEvents))
  log(`Validated ${extractedEvents.length} extracted events.`)

  log('Loading existing events.json.')
  const existingEvents = await loadCollection('events', projectDirectory)
  const retainedEvents = existingEvents.filter(
    (event) => !(event.sourceType === 'VOD' && event.vodId === vod.videoID),
  )
  const events = [...retainedEvents, ...extractedEvents].sort((first, second) => {
    if (first.datetime === null) return second.datetime === null ? 0 : 1
    if (second.datetime === null) return -1
    return Date.parse(second.datetime) - Date.parse(first.datetime)
  })

  log(`Saving ${extractedEvents.length} extracted events to events.json.`)
  await saveCollection('events', projectDirectory, events)
  log(`Saved events.json successfully with ${events.length} total events.`)

  return {
    events: extractedEvents,
    transcriptReused,
  }
}
