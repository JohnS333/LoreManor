import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import type { Channel, LoreEvent, Vod } from '../../shared/types/api'
import { fetchChannelVods, fetchVodEvents, loadChannels, loadEvents, loadVods, saveChannels, saveEvents } from './services/api'
import './App.css'

const PROJECT_DIRECTORY_STORAGE_KEY = 'loreManor.projectDirectory'
const GEMINI_API_KEY_STORAGE_KEY = 'loreManor.geminiApiKey'
const EVENT_LANES = ['Devlog', 'Story'] as const
const EVENT_SPANS = {
  story: ['Story'],
  devlog: ['Devlog'],
  both: EVENT_LANES,
} as const

type EventSpan = keyof typeof EVENT_SPANS
type ResizeEdge = 'left' | 'right'

const getEventSpan = (event: LoreEvent): EventSpan => {
  const story = event.allocatedTracks.includes('Story')
  const devlog = event.allocatedTracks.includes('Devlog')
  return story ? (devlog ? 'both' : 'story') : 'devlog'
}

const ensureEventAllocation = (event: LoreEvent): LoreEvent => {
  if (event.allocatedTracks.includes('Story') || event.allocatedTracks.includes('Devlog')) return event
  return { ...event, allocatedTracks: [...event.allocatedTracks, 'Devlog'] }
}

const normalizeEventAllocations = (events: LoreEvent[]) => events.map(ensureEventAllocation)

const getStoredProjectDirectory = () => localStorage.getItem(PROJECT_DIRECTORY_STORAGE_KEY) ?? ''
const getStoredGeminiApiKey = () => localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) ?? ''
const getProjectName = (directory: string) => directory.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || directory

const getVodColor = (videoID: string) => {
  let hash = 0
  for (const character of videoID) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 65% 68%)`
}

const parseTimestampSeconds = (timestamp: string) => {
  const hmsMatch = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d+))?$/.exec(timestamp.trim())
  if (hmsMatch) {
    const [, hours, minutes, seconds, fraction] = hmsMatch
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0)
  }

  const msMatch = /^(\d+):([0-5]\d)(?:\.(\d+))?$/.exec(timestamp.trim())
  if (msMatch) {
    const [, minutes, seconds, fraction] = msMatch
    return Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0)
  }

  return null
}

const getTimestampedVideoUrl = (videoURL: string, timestamp: string) => {
  const seconds = parseTimestampSeconds(timestamp)
  if (seconds === null) return videoURL

  try {
    const url = new URL(videoURL)
    url.searchParams.set('t', String(Math.floor(seconds)))
    return url.toString()
  } catch {
    return videoURL
  }
}

const getEventDurationLabel = (event: LoreEvent) => {
  const startSeconds = parseTimestampSeconds(event.starttime)
  const endSeconds = parseTimestampSeconds(event.endtime)
  if (startSeconds === null || endSeconds === null) return null

  const totalSeconds = Math.round(endSeconds - startSeconds)
  if (totalSeconds < 0) return null

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m`
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

const getEventDateTimeLabel = (event: LoreEvent) => {
  if (event.datetime && Number.isFinite(Date.parse(event.datetime))) {
    const date = new Date(event.datetime)
    return `${date.toLocaleDateString()} · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
  return `Date unavailable · ${event.starttime || 'Time unavailable'}`
}

const sortEventsNewestFirst = (events: LoreEvent[]) => [...events].sort((first, second) => {
  if (first.datetime === null) return second.datetime === null ? 0 : 1
  if (second.datetime === null) return -1
  return Date.parse(second.datetime) - Date.parse(first.datetime)
})

const computeInsertionDatetime = (above?: LoreEvent, below?: LoreEvent): string => {
  const aboveMs = above?.datetime ? Date.parse(above.datetime) : NaN
  const belowMs = below?.datetime ? Date.parse(below.datetime) : NaN

  if (Number.isFinite(aboveMs) && Number.isFinite(belowMs)) {
    return new Date(Math.round((aboveMs + belowMs) / 2)).toISOString()
  }
  if (Number.isFinite(aboveMs)) {
    return new Date(aboveMs - 60_000).toISOString()
  }
  if (Number.isFinite(belowMs)) {
    return new Date(belowMs + 60_000).toISOString()
  }
  return new Date().toISOString()
}

const isWindowsDirectory = (directory: string) =>
  /^[a-zA-Z]:\\(?:[^<>:"/\\|?*]+\\?)*$/.test(directory) ||
  /^\\\\[^<>:"/\\|?*]+\\[^<>:"/\\|?*]+(?:\\[^<>:"/\\|?*]+)*\\?$/.test(directory)

const getChannelNameFromUrl = (channelURL: string) => {
  try {
    const url = new URL(channelURL)
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const handle = segments.find((segment) => segment.startsWith('@'))
    if (handle) return handle

    const channelTypeIndex = segments.findIndex((segment) => ['channel', 'c', 'user'].includes(segment.toLowerCase()))
    if (channelTypeIndex >= 0 && segments[channelTypeIndex + 1]) return segments[channelTypeIndex + 1]

    const routeSuffixes = new Set(['videos', 'streams', 'shorts', 'live', 'featured', 'playlists'])
    return [...segments].reverse().find((segment) => !routeSuffixes.has(segment.toLowerCase())) ?? ''
  } catch {
    return ''
  }
}

function App() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [vods, setVods] = useState<Vod[]>([])
  const [events, setEvents] = useState<LoreEvent[]>([])
  const [projectDirectory, setProjectDirectory] = useState(getStoredProjectDirectory)
  const [directoryDraft, setDirectoryDraft] = useState(projectDirectory)
  const [geminiApiKey, setGeminiApiKey] = useState(getStoredGeminiApiKey)
  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState(geminiApiKey)
  const [geminiApiKeyNotice, setGeminiApiKeyNotice] = useState('')
  const [directoryError, setDirectoryError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [channelFormOpen, setChannelFormOpen] = useState(false)
  const [channelUrlDraft, setChannelUrlDraft] = useState('')
  const [channelNameDraft, setChannelNameDraft] = useState('')
  const [channelError, setChannelError] = useState('')
  const [loadedChannelsDirectory, setLoadedChannelsDirectory] = useState('')
  const [channelsLoadError, setChannelsLoadError] = useState('')
  const [channelSaving, setChannelSaving] = useState(false)
  const [fetchingChannelURL, setFetchingChannelURL] = useState<string | null>(null)
  const [vodsFetchError, setVodsFetchError] = useState('')
  const [vodsFetchNotice, setVodsFetchNotice] = useState('')
  const [loadedVodsDirectory, setLoadedVodsDirectory] = useState('')
  const [vodsLoadError, setVodsLoadError] = useState('')
  const [loadedEventsDirectory, setLoadedEventsDirectory] = useState('')
  const [eventsLoadError, setEventsLoadError] = useState('')
  const [extractingVideoID, setExtractingVideoID] = useState<string | null>(null)
  const [eventExtractionError, setEventExtractionError] = useState('')
  const [eventExtractionNotice, setEventExtractionNotice] = useState('')
  const [eventSaving, setEventSaving] = useState(false)
  const [eventSaveError, setEventSaveError] = useState('')
  const [eventDialog, setEventDialog] = useState<
    | { mode: 'add'; datetime: string }
    | { mode: 'edit' | 'delete'; eventID: string }
    | null
  >(null)
  const eventDialogRef = useRef<HTMLDialogElement>(null)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const resizeStartX = useRef<number | null>(null)
  const allocationGridRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const vodCardRefs = useRef(new Map<string, HTMLElement>())
  const eventCardRefs = useRef(new Map<string, HTMLElement>())
  const eventRowRefs = useRef(new Map<string, HTMLDivElement>())
  const eventsRef = useRef(events)
  const [dragState, setDragState] = useState<{ eventID: string; originalIndex: number; targetIndex: number } | null>(null)
  const dragStateRef = useRef<{ eventID: string; originalIndex: number; targetIndex: number } | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [connectorPaths, setConnectorPaths] = useState<{ path: string; color: string }[]>([])
  const [connectorSize, setConnectorSize] = useState({ width: 0, height: 0 })
  const [connectorClipTop, setConnectorClipTop] = useState(0)
  const [connectorClipBottom, setConnectorClipBottom] = useState(0)
  const channelsLoading = Boolean(projectDirectory) && loadedChannelsDirectory !== projectDirectory && !channelsLoadError
  const vodsLoading = Boolean(projectDirectory) && loadedVodsDirectory !== projectDirectory && !vodsLoadError
  const eventsLoading = Boolean(projectDirectory) && loadedEventsDirectory !== projectDirectory && !eventsLoadError
  const eventWriteInProgress = eventSaving || Boolean(extractingVideoID)
  const eventWritesDisabled = eventWriteInProgress || eventsLoading || Boolean(eventsLoadError) || !projectDirectory

  useLayoutEffect(() => {
    const tracks = tracksRef.current
    if (!tracks) return

    let frame: number | null = null
    const updateConnectors = () => {
      frame = null
      const tracksRect = tracks.getBoundingClientRect()
      setConnectorSize({ width: tracks.clientWidth, height: tracks.clientHeight })
      const eventScroll = tracks.querySelector('.allocation-lanes .event-scroll')
      if (eventScroll) {
        const eventScrollRect = eventScroll.getBoundingClientRect()
        setConnectorClipTop(Math.max(0, eventScrollRect.top - tracksRect.top))
        setConnectorClipBottom(Math.max(0, tracksRect.bottom - eventScrollRect.bottom))
      }
      const paths = events.flatMap((event) => {
        if (event.sourceType !== 'VOD' || !event.vodId) return []
        const vodCard = vodCardRefs.current.get(event.vodId)
        if (!vodCard) return []
        const color = getVodColor(event.vodId)

        const vodRect = vodCard.getBoundingClientRect()
        const startX = vodRect.right - tracksRect.left
        const startY = vodRect.top + vodRect.height / 2 - tracksRect.top
        return [...eventCardRefs.current.entries()]
          .filter(([key]) => key.startsWith(`${event.eventID}:`))
          .map(([, eventCard]) => {
            const eventRect = eventCard.getBoundingClientRect()
            const endX = eventRect.left - tracksRect.left
            const endY = eventRect.top + eventRect.height / 2 - tracksRect.top
            const curve = Math.max(28, (endX - startX) * 0.45)
            return {
              path: `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`,
              color,
            }
          })
      })
      setConnectorPaths(paths)
    }
    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateConnectors)
    }
    const scrollElements = tracks.querySelectorAll('.track-scroll')
    scrollElements.forEach((element) => element.addEventListener('scroll', scheduleUpdate, { passive: true }))
    window.addEventListener('resize', scheduleUpdate)
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(tracks)
    scheduleUpdate()

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      scrollElements.forEach((element) => element.removeEventListener('scroll', scheduleUpdate))
      window.removeEventListener('resize', scheduleUpdate)
      resizeObserver.disconnect()
    }
  }, [events, vods, eventsLoading, dragState?.targetIndex])

  useEffect(() => {
    eventsRef.current = events
  }, [events])

  useEffect(() => () => {
    dragCleanupRef.current?.()
  }, [])

  useEffect(() => {
    if (!projectDirectory) return

    let isCurrent = true
    loadChannels(projectDirectory)
      .then((storedChannels) => {
        if (isCurrent) {
          setChannels(storedChannels)
          setLoadedChannelsDirectory(projectDirectory)
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) setChannelsLoadError(error instanceof Error ? error.message : 'Unable to load channels.')
      })

    return () => {
      isCurrent = false
    }
  }, [projectDirectory])

  useEffect(() => {
    if (!projectDirectory) return

    let isCurrent = true
    loadVods(projectDirectory)
      .then((storedVods) => {
        if (isCurrent) {
          setVods(storedVods)
          setLoadedVodsDirectory(projectDirectory)
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) setVodsLoadError(error instanceof Error ? error.message : 'Unable to load VODs.')
      })

    return () => {
      isCurrent = false
    }
  }, [projectDirectory])

  useEffect(() => {
    if (!projectDirectory) return

    let isCurrent = true
    loadEvents(projectDirectory)
      .then(async (storedEvents) => {
        if (isCurrent) {
          const normalizedEvents = sortEventsNewestFirst(normalizeEventAllocations(storedEvents))
          if (normalizedEvents.some((item, index) => item !== storedEvents[index])) {
            await saveEvents(projectDirectory, normalizedEvents)
          }
          if (isCurrent) {
            setEvents(normalizedEvents)
            setLoadedEventsDirectory(projectDirectory)
          }
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) setEventsLoadError(error instanceof Error ? error.message : 'Unable to load events.')
      })

    return () => {
      isCurrent = false
    }
  }, [projectDirectory])

  const openSettings = () => {
    setDirectoryDraft(projectDirectory)
    setGeminiApiKeyDraft(geminiApiKey)
    setDirectoryError('')
    setGeminiApiKeyNotice('')
    setSettingsOpen(true)
  }

  const saveProjectDirectory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (eventWriteInProgress) return
    const directory = directoryDraft.trim()

    if (!isWindowsDirectory(directory)) {
      setDirectoryError('Enter an absolute Windows path, such as C:\\LoreManor.')
      return
    }
    if (directory === projectDirectory) {
      setSettingsOpen(false)
      return
    }

    localStorage.setItem(PROJECT_DIRECTORY_STORAGE_KEY, directory)
    setChannels([])
    setVods([])
    setEvents([])
    setLoadedChannelsDirectory('')
    setLoadedVodsDirectory('')
    setLoadedEventsDirectory('')
    setChannelsLoadError('')
    setVodsLoadError('')
    setEventsLoadError('')
    setVodsFetchError('')
    setVodsFetchNotice('')
    setEventExtractionError('')
    setEventExtractionNotice('')
    setEventSaveError('')
    setProjectDirectory(directory)
    setSettingsOpen(false)
  }

  const clearProjectDirectory = () => {
    if (eventWriteInProgress) return
    localStorage.removeItem(PROJECT_DIRECTORY_STORAGE_KEY)
    setProjectDirectory('')
    setChannels([])
    setVods([])
    setEvents([])
    setLoadedChannelsDirectory('')
    setLoadedVodsDirectory('')
    setLoadedEventsDirectory('')
    setChannelsLoadError('')
    setVodsLoadError('')
    setEventsLoadError('')
    setVodsFetchError('')
    setVodsFetchNotice('')
    setEventExtractionError('')
    setEventExtractionNotice('')
    setEventSaveError('')
    setDirectoryDraft('')
    setDirectoryError('')
  }

  const saveGeminiApiKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const apiKey = geminiApiKeyDraft.trim()
    if (apiKey) {
      localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, apiKey)
      setGeminiApiKey(apiKey)
      setGeminiApiKeyDraft(apiKey)
      setGeminiApiKeyNotice('Gemini API key saved in this browser.')
      return
    }

    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY)
    setGeminiApiKey('')
    setGeminiApiKeyNotice('Gemini API key removed from this browser.')
  }

  const clearGeminiApiKey = () => {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY)
    setGeminiApiKey('')
    setGeminiApiKeyDraft('')
    setGeminiApiKeyNotice('Gemini API key removed from this browser.')
  }

  const addChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setChannelError('')

    if (!projectDirectory) {
      setChannelError('Set the project directory in Settings before adding a channel.')
      return
    }

    let normalizedUrl: URL
    try {
      normalizedUrl = new URL(channelUrlDraft.trim())
    } catch {
      setChannelError('Enter a valid channel URL.')
      return
    }
    if (normalizedUrl.protocol !== 'https:' && normalizedUrl.protocol !== 'http:') {
      setChannelError('Channel URLs must use HTTP or HTTPS.')
      return
    }

    const channelURL = channelUrlDraft.trim()
    if (channels.some((channel) => channel.channelURL === channelURL)) {
      setChannelError('That channel URL has already been added.')
      return
    }

    const channelName = channelNameDraft.trim() || getChannelNameFromUrl(channelURL)
    if (!channelName) {
      setChannelError('Enter a channel name, or use a URL with a recognizable name.')
      return
    }

    const updatedChannels: Channel[] = [...channels, { channelURL, channelName }]
    setChannelSaving(true)
    try {
      await saveChannels(projectDirectory, updatedChannels)
      setChannels(updatedChannels)
      setChannelUrlDraft('')
      setChannelNameDraft('')
      setChannelFormOpen(false)
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : 'Unable to save the channel.')
    } finally {
      setChannelSaving(false)
    }
  }

  const fetchVodsForChannel = async (channel: Channel) => {
    if (!projectDirectory || fetchingChannelURL) return
    setFetchingChannelURL(channel.channelURL)
    setVodsFetchError('')
    setVodsFetchNotice('')

    try {
      const result = await fetchChannelVods(projectDirectory, channel.channelURL)
      setVods(result.vods)
      setVodsFetchNotice(
        result.addedCount === 0
          ? `No new VODs found for ${channel.channelName}.`
          : `Added ${result.addedCount} VOD${result.addedCount === 1 ? '' : 's'} from ${channel.channelName}.`,
      )
    } catch (error) {
      setVodsFetchError(error instanceof Error ? error.message : `Unable to fetch VODs from ${channel.channelName}.`)
    } finally {
      setFetchingChannelURL(null)
    }
  }

  const extractEventsForVod = async (vod: Vod) => {
    if (eventWritesDisabled) return
    if (!geminiApiKey.trim()) {
      setEventExtractionError('Add a Gemini API key in Settings before extracting events.')
      openSettings()
      return
    }

    setExtractingVideoID(vod.videoID)
    setEventExtractionError('')
    setEventExtractionNotice('')

    try {
      const result = await fetchVodEvents(projectDirectory, vod, geminiApiKey)
      const updatedEvents = sortEventsNewestFirst(normalizeEventAllocations([
        ...events.filter((event) => !(event.sourceType === 'VOD' && event.vodId === vod.videoID)),
        ...result.events,
      ]))
      await saveEvents(projectDirectory, updatedEvents)
      setEvents(updatedEvents)
      setEventExtractionNotice(
        result.transcriptReused
          ? `Extracted ${result.events.length} event${result.events.length === 1 ? '' : 's'} from the cached transcript.`
          : `Extracted ${result.events.length} event${result.events.length === 1 ? '' : 's'} and saved the transcript.`,
      )
    } catch (error) {
      setEventExtractionError(error instanceof Error ? error.message : `Unable to extract events from ${vod.vodTitle}.`)
    } finally {
      setExtractingVideoID(null)
    }
  }

  const saveEventChanges = async (updatedEvents: LoreEvent[]) => {
    if (eventWritesDisabled) return false
    setEventSaving(true)
    setEventSaveError('')
    try {
      await saveEvents(projectDirectory, updatedEvents)
      setEvents(updatedEvents)
      return true
    } catch (error) {
      setEventSaveError(error instanceof Error ? error.message : 'Unable to save event changes.')
      return false
    } finally {
      setEventSaving(false)
    }
  }

  const openAddEventDialog = (above?: LoreEvent, below?: LoreEvent) => {
    if (eventWritesDisabled) return
    setEventSaveError('')
    setDescriptionDraft('')
    setEventDialog({ mode: 'add', datetime: computeInsertionDatetime(above, below) })
  }

  const openEventDialog = (mode: 'edit' | 'delete', event: LoreEvent) => {
    setEventSaveError('')
    setDescriptionDraft(event.description)
    setEventDialog({ mode, eventID: event.eventID })
  }

  useLayoutEffect(() => {
    if (eventDialog) eventDialogRef.current?.showModal()
  }, [eventDialog])

  const submitEventDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!eventDialog) return
    const description = descriptionDraft.trim()
    if ((eventDialog.mode === 'add' || eventDialog.mode === 'edit') && !description) {
      setEventSaveError('Enter an event description.')
      return
    }
    const updatedEvents = eventDialog.mode === 'add'
      ? sortEventsNewestFirst([
        ...events,
        {
          eventID: `manual-${crypto.randomUUID()}`,
          sourceType: 'manual',
          vodId: null,
          datetime: eventDialog.datetime,
          starttime: '',
          endtime: '',
          description,
          shortsViable: null,
          allocatedTracks: ['Devlog'],
          projectAllocations: [],
        },
      ])
      : eventDialog.mode === 'delete'
        ? events.filter(({ eventID }) => eventID !== eventDialog.eventID)
        : events.map((item) => item.eventID === eventDialog.eventID ? { ...item, description } : item)
    if (await saveEventChanges(updatedEvents)) eventDialogRef.current?.close()
  }

  const startEventDrag = (pointer: PointerEvent<HTMLElement>, event: LoreEvent) => {
    if (eventWritesDisabled || !pointer.isPrimary || pointer.button !== 0 || event.sourceType !== 'manual') return
    if ((pointer.target as HTMLElement).closest('button, a, input, textarea, select, .event-resize-handle')) return

    const originalIndex = eventsRef.current.findIndex((item) => item.eventID === event.eventID)
    if (originalIndex < 0) return

    dragCleanupRef.current?.()
    const pointerId = pointer.pointerId
    const startY = pointer.clientY
    const eventID = event.eventID

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      dragCleanupRef.current = null
    }

    const onCancel = () => {
      cleanup()
      dragStateRef.current = null
      setDragState(null)
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') onCancel()
    }

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (!dragStateRef.current) {
        if (Math.abs(moveEvent.clientY - startY) < 4) return
        const initial = { eventID, originalIndex, targetIndex: originalIndex }
        dragStateRef.current = initial
        setDragState(initial)
      }

      const otherEvents = eventsRef.current.filter((item) => item.eventID !== eventID)
      let nextTargetIndex = 0
      for (const other of otherEvents) {
        const row = eventRowRefs.current.get(other.eventID)
        if (!row) continue
        const rect = row.getBoundingClientRect()
        if (moveEvent.clientY > rect.top + rect.height / 2) nextTargetIndex += 1
      }

      if (dragStateRef.current.targetIndex !== nextTargetIndex) {
        const updated = { ...dragStateRef.current, targetIndex: nextTargetIndex }
        dragStateRef.current = updated
        setDragState(updated)
      }
    }

    const onPointerUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      const finalDrag = dragStateRef.current
      cleanup()
      dragStateRef.current = null
      setDragState(null)

      if (!finalDrag || finalDrag.targetIndex === finalDrag.originalIndex) return
      const currentEvents = eventsRef.current
      const draggedEvent = currentEvents.find((item) => item.eventID === finalDrag.eventID)
      if (!draggedEvent) return

      const otherEvents = currentEvents.filter((item) => item.eventID !== finalDrag.eventID)
      const newDatetime = computeInsertionDatetime(
        otherEvents[finalDrag.targetIndex - 1],
        otherEvents[finalDrag.targetIndex],
      )
      const updatedEvent: LoreEvent = { ...draggedEvent, datetime: newDatetime }
      const reordered = [...otherEvents]
      reordered.splice(finalDrag.targetIndex, 0, updatedEvent)
      void saveEventChanges(sortEventsNewestFirst(reordered))
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    dragCleanupRef.current = cleanup
  }

  const saveEventSpan = (event: LoreEvent, span: EventSpan) => {
    if (span === getEventSpan(event)) return
    void saveEventChanges(events.map((item) => item.eventID === event.eventID ? {
      ...ensureEventAllocation(item),
      allocatedTracks: [
        ...ensureEventAllocation(item).allocatedTracks.filter((track) => track !== 'Story' && track !== 'Devlog'),
        ...EVENT_SPANS[span],
      ],
    } : item))
  }

  const cancelResize = () => {
    resizeStartX.current = null
  }

  const renderResizeHandle = (event: LoreEvent, edge: ResizeEdge) => {
    const getSpanAtPointer = (pointer: PointerEvent<HTMLElement>): EventSpan => {
      const grid = allocationGridRef.current?.getBoundingClientRect()
      if (!grid || resizeStartX.current === null || Math.abs(pointer.clientX - resizeStartX.current) < 4) {
        return getEventSpan(event)
      }
      const overDevlog = pointer.clientX < grid.left + grid.width / 2
      return edge === 'left' ? (overDevlog ? 'both' : 'story') : (overDevlog ? 'devlog' : 'both')
    }

    return (
      <span
        aria-hidden="true"
        className={`event-resize-handle ${edge}`}
        title={`Drag to resize the ${edge} edge`}
        onPointerDown={(pointer) => {
          if (eventWritesDisabled || !pointer.isPrimary || pointer.button !== 0) return
          pointer.preventDefault()
          pointer.currentTarget.setPointerCapture(pointer.pointerId)
          resizeStartX.current = pointer.clientX
        }}
        onPointerUp={(pointer) => {
          if (!pointer.currentTarget.hasPointerCapture(pointer.pointerId)) return
          const span = getSpanAtPointer(pointer)
          cancelResize()
          saveEventSpan(event, span)
        }}
        onLostPointerCapture={cancelResize}
      />
    )
  }

  const renderEventCard = (event: LoreEvent, placeholder = false) => {
    const vod = event.vodId ? vods.find((candidate) => candidate.videoID === event.vodId) : undefined
    const span = getEventSpan(event)
    const displayedSpan = span
    const durationLabel = getEventDurationLabel(event)
    const isManual = event.sourceType === 'manual'
    const isDragging = !placeholder && dragState?.eventID === event.eventID
    return (
      <article
        ref={placeholder ? undefined : (element) => {
          const cardKey = `${event.eventID}:allocation`
          if (element) eventCardRefs.current.set(cardKey, element)
          else eventCardRefs.current.delete(cardKey)
        }}
        aria-hidden={placeholder || undefined}
        className={`event-card allocated-event${placeholder ? ' event-card-placeholder' : ''}${isManual ? ' manual-event' : ''}${isDragging ? ' dragging-preview' : ''}`}
        onPointerDown={placeholder || !isManual ? undefined : (pointer) => startEventDrag(pointer, event)}
        style={{
          ...(event.sourceType === 'VOD' && event.vodId ? { borderLeft: `4px solid ${getVodColor(event.vodId)}` } : {}),
          ...(vod?.thumbnailURL ? {
            backgroundImage: `linear-gradient(90deg, rgba(34, 32, 29, 0.30) 0%, rgba(34, 32, 29, 0.85) 55%, var(--panel-raised) 100%), url("${vod.thumbnailURL}")`,
          } : {}),
        }}
      >
        <span>{event.description}</span>
        <div className="event-card-meta">
          <time className="event-card-datetime" dateTime={event.datetime ?? undefined}>
            {getEventDateTimeLabel(event)}
          </time>
          {durationLabel && (
            <span className="event-card-duration" title="Clip duration">
              {durationLabel}
            </span>
          )}
          <div className="event-card-actions">
            {vod && (
              <a
                className="event-action-icon event-youtube-button"
                href={getTimestampedVideoUrl(vod.videoURL, event.starttime)}
                target="_blank"
                rel="noreferrer"
                tabIndex={placeholder ? -1 : undefined}
                aria-label={`Watch event at ${event.starttime}`}
                title={`Watch at ${event.starttime}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
                  <path d="M10 9v6l5-3z" fill="#fff" />
                </svg>
              </a>
            )}
            <button
              type="button"
              className="event-action-icon"
              disabled={placeholder || eventWritesDisabled}
              aria-label="Edit event"
              title="Edit event"
              onClick={() => openEventDialog('edit', event)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              className="event-action-icon event-delete-button"
              disabled={placeholder || eventWritesDisabled}
              aria-label="Delete event"
              title="Delete event"
              onClick={() => openEventDialog('delete', event)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
          </div>
        </div>
        {!placeholder && displayedSpan !== 'devlog' && renderResizeHandle(event, 'left')}
        {!placeholder && displayedSpan !== 'story' && renderResizeHandle(event, 'right')}
      </article>
    )
  }

  const allocatedEvents = (() => {
    if (!dragState) return events
    const draggedEvent = events.find((item) => item.eventID === dragState.eventID)
    if (!draggedEvent) return events
    const otherEvents = events.filter((item) => item.eventID !== dragState.eventID)
    const previewDatetime = computeInsertionDatetime(
      otherEvents[dragState.targetIndex - 1],
      otherEvents[dragState.targetIndex],
    )
    const previewEvent: LoreEvent = { ...draggedEvent, datetime: previewDatetime }
    const reordered = [...otherEvents]
    reordered.splice(dragState.targetIndex, 0, previewEvent)
    return reordered
  })()

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/src/assets/lore-manor-icon.svg" alt="" />
          <span>Lore Manor</span>
          {projectDirectory && (
            <>
              <span className="brand-project-separator" aria-hidden="true">|</span>
              <span className="brand-project-name" title={projectDirectory}>{getProjectName(projectDirectory)}</span>
            </>
          )}
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" type="button">
            <span className="folder-icon" aria-hidden="true">⌑</span>
            Projects
            <span className="count">0</span>
          </button>
          <button className="icon-button" type="button" aria-label="Settings" onClick={openSettings}>⚙</button>
        </div>
      </header>

      <div className="tracks" ref={tracksRef}>
        <svg
          className="connector-overlay"
          style={{
            clipPath: `inset(${connectorClipTop}px 0 ${connectorClipBottom}px 0)`,
            maskImage: `linear-gradient(to bottom, transparent ${connectorClipTop}px, black ${connectorClipTop + 28}px, black calc(100% - ${connectorClipBottom + 28}px), transparent calc(100% - ${connectorClipBottom}px))`,
          }}
          aria-hidden="true"
          viewBox={`0 0 ${connectorSize.width} ${connectorSize.height}`}
          preserveAspectRatio="none"
        >
          {connectorPaths.map(({ path, color }, index) => <path key={`${path}-${index}`} d={path} stroke={color} />)}
        </svg>
        <section className="track channels-track" aria-labelledby="channels-heading">
          <div className="track-header">
            <div>
              <p className="track-kicker">Sources</p>
              <h1 id="channels-heading">Channels</h1>
            </div>
            <span className="count">{channels.length}</span>
          </div>
          <button className="add-button" type="button" onClick={() => {
            setChannelError('')
            setChannelFormOpen(true)
          }}>
            <span aria-hidden="true">+</span>
            Add channel
          </button>
          <div className={`track-scroll channel-scroll ${channels.length === 0 ? 'empty-scroll' : ''}`}>
            {channelsLoading ? (
              <div className="empty-state"><p>Loading channels…</p></div>
            ) : channelsLoadError ? (
              <div className="empty-state"><p className="field-error">{channelsLoadError}</p></div>
            ) : channels.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon channel-icon" aria-hidden="true">◉</div>
                <h2>No channels</h2>
                <p>Add a YouTube channel to start loading VODs.</p>
              </div>
            ) : channels.map((channel) => (
              <article className="channel-card" key={channel.channelURL}>
                <strong>{channel.channelName}</strong>
                <span>{channel.channelURL}</span>
                <button
                  className="channel-fetch-button"
                  type="button"
                  onClick={() => void fetchVodsForChannel(channel)}
                  disabled={!projectDirectory || Boolean(fetchingChannelURL) || vodsLoading}
                >
                  {fetchingChannelURL === channel.channelURL ? 'Fetching…' : 'Fetch VODs'}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="track vods-track" aria-labelledby="vods-heading">
          <div className="track-header">
            <div>
              <p className="track-kicker">Library</p>
              <h1 id="vods-heading">VODs</h1>
            </div>
            <div className="vod-actions">
              <span className="count">{vods.length}</span>
            </div>
          </div>
          <div className={`track-scroll vod-scroll ${vods.length === 0 && !vodsFetchError && !vodsFetchNotice ? 'empty-scroll' : ''}`}>
            {vodsLoading ? (
              <div className="empty-state"><p>Loading VODs…</p></div>
            ) : vodsLoadError ? (
              <div className="empty-state"><p className="field-error" role="alert">{vodsLoadError}</p></div>
            ) : vods.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true">
                  <span className="play-icon">▶</span>
                </div>
                <h2>No VODs yet</h2>
                <p>Add a channel, then fetch its available videos.</p>
              </div>
            ) : (
              vods.map((vod) => (
                <article
                  className="vod-card"
                  style={{ borderLeft: `4px solid ${getVodColor(vod.videoID)}` }}
                  key={vod.videoID}
                  ref={(element) => {
                    if (element) vodCardRefs.current.set(vod.videoID, element)
                    else vodCardRefs.current.delete(vod.videoID)
                  }}
                >
                  {vod.thumbnailURL && <img src={vod.thumbnailURL} alt="" loading="lazy" />}
                  <div className="vod-card-details">
                    <a href={vod.videoURL} target="_blank" rel="noreferrer">{vod.vodTitle}</a>
                    {vod.datetime && <time dateTime={vod.datetime}>{new Date(vod.datetime).toLocaleDateString()}</time>}
                    <button
                      className="channel-fetch-button event-extract-button"
                      type="button"
                      onClick={() => void extractEventsForVod(vod)}
                      disabled={eventWritesDisabled}
                    >
                      {extractingVideoID === vod.videoID ? 'Extracting…' : 'Extract events'}
                    </button>
                  </div>
                </article>
              ))
            )}
            {(vodsFetchError || vodsFetchNotice) && (
              <p className={vodsFetchError ? 'field-error vod-fetch-message' : 'vod-fetch-notice'} role={vodsFetchError ? 'alert' : 'status'}>
                {vodsFetchError || vodsFetchNotice}
              </p>
            )}
            {(eventExtractionError || eventExtractionNotice) && (
              <p className={eventExtractionError ? 'field-error vod-fetch-message' : 'vod-fetch-notice'} role={eventExtractionError ? 'alert' : 'status'}>
                {eventExtractionError || eventExtractionNotice}
              </p>
            )}
          </div>
        </section>

        <section className="track events-track" aria-labelledby="events-heading">
          <div className="track-header events-header">
            <div>
              <p className="track-kicker">Timeline</p>
              <h1 id="events-heading">Events</h1>
            </div>
            <div className="event-actions">
              <button
                className="add-event-button"
                type="button"
                disabled={eventWritesDisabled}
                onClick={() => openAddEventDialog(undefined, events[0])}
              >
                <span aria-hidden="true">+</span>
                Add event
              </button>
            </div>
          </div>

          {eventSaveError && !eventDialog && (
            <p className="field-error event-save-error" role="alert">{eventSaveError}</p>
          )}
          <div className="events-content">
            <div className="allocation-column allocation-lanes" aria-label="Event allocation lanes" role="group">
              <div className="allocation-headers">
                {EVENT_LANES.map((trackName) => (
                  <div className="allocation-header" key={trackName}>
                    <span>{trackName}</span>
                    <span className="count">
                      {events.filter((event) => getEventSpan(event) === 'both' || getEventSpan(event) === trackName.toLowerCase()).length}
                    </span>
                  </div>
                ))}
              </div>
              <div className="track-scroll event-scroll">
                {eventsLoading ? (
                  <div className="empty-state events-empty"><p>Loading events…</p></div>
                ) : eventsLoadError ? (
                  <div className="empty-state events-empty"><p className="field-error" role="alert">{eventsLoadError}</p></div>
                ) : allocatedEvents.length === 0 ? (
                  <div className="empty-state events-empty">
                    <div className="empty-icon timeline-icon" aria-hidden="true">⋮</div>
                    <h2>No events</h2>
                    <p>Extracted moments and manually added events will appear here.</p>
                  </div>
                ) : (
                  <div className={`allocation-grid${dragState ? ' is-dragging' : ''}`} ref={allocationGridRef}>
                    {allocatedEvents.map((event, index) => {
                      const span = getEventSpan(event)
                      const isDraggingRow = dragState?.eventID === event.eventID
                      return (
                        <Fragment key={event.eventID}>
                          <div
                            className={`allocation-row${span === 'both' ? ' spanning' : ''}${isDraggingRow ? ' dragging-row' : ''}`}
                            ref={(element) => {
                              if (element) eventRowRefs.current.set(event.eventID, element)
                              else eventRowRefs.current.delete(event.eventID)
                            }}
                          >
                            <div className="allocation-slot">
                              {span === 'devlog' ? renderEventCard(event) : renderEventCard(event, true)}
                            </div>
                            <div className="allocation-slot">
                              {span === 'story' ? renderEventCard(event) : renderEventCard(event, true)}
                            </div>
                            {span === 'both' && (
                              <div className="allocation-span-overlay">{renderEventCard(event)}</div>
                            )}
                          </div>
                          {index < allocatedEvents.length - 1 && (
                            <div className="event-insert-divider">
                              <button
                                type="button"
                                className="event-insert-button"
                                disabled={eventWritesDisabled || Boolean(dragState)}
                                aria-label="Add manual event between these events"
                                title="Add manual event here"
                                onClick={() => openAddEventDialog(allocatedEvents[index], allocatedEvents[index + 1])}
                              >
                                <span aria-hidden="true">+</span>
                              </button>
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-heading"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <div>
                <p className="track-kicker">Configuration</p>
                <h2 id="settings-heading">Settings</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <form className="settings-form" onSubmit={saveProjectDirectory}>
              <label htmlFor="project-directory">Project directory</label>
              <p className="field-description">The Windows folder containing this project's JSON, captions, and videos.</p>
              <input
                id="project-directory"
                type="text"
                value={directoryDraft}
                onChange={(event) => {
                  setDirectoryDraft(event.target.value)
                  setDirectoryError('')
                }}
                placeholder="C:\\Users\\Name\\LoreManor"
                autoComplete="off"
                aria-describedby={directoryError ? 'directory-error' : undefined}
                required
              />
              {directoryError && <p className="field-error" id="directory-error">{directoryError}</p>}
              <div className="settings-actions">
                <button className="clear-button" type="button" onClick={clearProjectDirectory} disabled={!projectDirectory || eventWriteInProgress}>Clear</button>
                <button className="save-button" type="submit" disabled={eventWriteInProgress}>Save directory</button>
              </div>
            </form>
            <form className="settings-form settings-key-form" onSubmit={saveGeminiApiKey}>
              <label htmlFor="gemini-api-key">Gemini API key</label>
              <p className="field-description">
                Stored in this browser only (not encrypted). Sent to the server for extraction; never saved with project files.
              </p>
              <input
                id="gemini-api-key"
                type="password"
                value={geminiApiKeyDraft}
                onChange={(event) => {
                  setGeminiApiKeyDraft(event.target.value)
                  setGeminiApiKeyNotice('')
                }}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={geminiApiKey ? 'Saved API key' : 'Enter your Gemini API key'}
              />
              {geminiApiKeyNotice && <p className="field-description" role="status">{geminiApiKeyNotice}</p>}
              <div className="settings-actions">
                <button className="clear-button" type="button" onClick={clearGeminiApiKey} disabled={!geminiApiKey}>Remove key</button>
                <button className="save-button" type="submit">Save key</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {eventDialog && (
        <dialog
          ref={eventDialogRef}
          className="settings-dialog event-dialog"
          aria-labelledby="event-dialog-heading"
          onClose={() => {
            setEventDialog(null)
            setEventSaveError('')
          }}
          onCancel={(event) => {
            if (eventSaving) event.preventDefault()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            if (!eventSaving) event.currentTarget.close()
          }}
        >
          <div className="settings-header">
            <div>
              <p className="track-kicker">Timeline</p>
              <h2 id="event-dialog-heading">
                {eventDialog.mode === 'add' ? 'Add manual event' : eventDialog.mode === 'edit' ? 'Edit event' : 'Delete event'}
              </h2>
            </div>
          </div>
          <form className="settings-form" onSubmit={(event) => void submitEventDialog(event)}>
            {eventDialog.mode === 'add' || eventDialog.mode === 'edit' ? (
              <>
                {eventDialog.mode === 'add' && (
                  <p className="field-description">
                    Starting time:{' '}
                    <time dateTime={eventDialog.datetime}>
                      {new Date(eventDialog.datetime).toLocaleDateString()} · {new Date(eventDialog.datetime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </time>
                  </p>
                )}
                <label htmlFor="event-description">Description</label>
                <textarea
                  id="event-description"
                  rows={5}
                  value={descriptionDraft}
                  disabled={eventSaving}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  required
                />
              </>
            ) : (
              <>
                <p className="field-description">Delete this event from the timeline? Source files and clips will not be deleted.</p>
                <p className="event-description">{descriptionDraft}</p>
              </>
            )}
            {eventSaveError && <p className="field-error" role="alert">{eventSaveError}</p>}
            <div className="settings-actions">
              <button className="clear-button" type="button" onClick={() => eventDialogRef.current?.close()} disabled={eventSaving}>Cancel</button>
              <button className="save-button" type="submit" disabled={eventWritesDisabled}>
                {eventSaving ? 'Saving...' : eventDialog.mode === 'add' ? 'Add event' : eventDialog.mode === 'edit' ? 'Save description' : 'Delete event'}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {channelFormOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setChannelFormOpen(false)}>
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-channel-heading"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <div>
                <p className="track-kicker">Sources</p>
                <h2 id="add-channel-heading">Add channel</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close add channel" onClick={() => setChannelFormOpen(false)}>×</button>
            </div>
            <form className="settings-form" onSubmit={addChannel}>
              <label htmlFor="channel-url">YouTube channel URL</label>
              <p className="field-description">The channel name is inferred from the URL when possible; you can override it below.</p>
              <input
                id="channel-url"
                type="url"
                value={channelUrlDraft}
                onChange={(event) => {
                  setChannelUrlDraft(event.target.value)
                  setChannelError('')
                }}
                placeholder="https://www.youtube.com/@channel"
                autoComplete="url"
                required
              />
              <label className="channel-name-label" htmlFor="channel-name">Channel name <span>(optional)</span></label>
              <input
                id="channel-name"
                type="text"
                value={channelNameDraft}
                onChange={(event) => setChannelNameDraft(event.target.value)}
                placeholder={getChannelNameFromUrl(channelUrlDraft) || 'Inferred from channel URL'}
                autoComplete="off"
              />
              {!projectDirectory && (
                <p className="field-error">Set the project directory in Settings before saving a channel.</p>
              )}
              {channelError && <p className="field-error" role="alert">{channelError}</p>}
              <div className="settings-actions">
                <button className="clear-button" type="button" onClick={() => setChannelFormOpen(false)}>Cancel</button>
                <button className="save-button" type="submit" disabled={channelSaving || channelsLoading || Boolean(channelsLoadError)}>
                  {channelSaving ? 'Saving…' : 'Save channel'}
                </button>
              </div>
              {!projectDirectory && (
                <button className="settings-link-button" type="button" onClick={() => {
                  setChannelFormOpen(false)
                  openSettings()
                }}>Open Settings</button>
              )}
            </form>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
