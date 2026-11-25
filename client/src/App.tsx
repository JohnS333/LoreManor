import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { Channel, LoreEvent, Vod } from '../../shared/types/api'
import { fetchChannelVods, fetchVodEvents, loadChannels, loadEvents, loadVods, saveChannels } from './services/api'
import './App.css'

const PROJECT_DIRECTORY_STORAGE_KEY = 'loreManor.projectDirectory'
const GEMINI_API_KEY_STORAGE_KEY = 'loreManor.geminiApiKey'

const getStoredProjectDirectory = () => localStorage.getItem(PROJECT_DIRECTORY_STORAGE_KEY) ?? ''
const getStoredGeminiApiKey = () => localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) ?? ''

const getVodColor = (videoID: string) => {
  let hash = 0
  for (const character of videoID) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 65% 68%)`
}

const sortEventsNewestFirst = (events: LoreEvent[]) => [...events].sort((first, second) => {
  if (first.datetime === null) return second.datetime === null ? 0 : 1
  if (second.datetime === null) return -1
  return Date.parse(second.datetime) - Date.parse(first.datetime)
})

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
  const [splitAllocations, setSplitAllocations] = useState(true)
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null)
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
  const tracksRef = useRef<HTMLDivElement>(null)
  const vodCardRefs = useRef(new Map<string, HTMLElement>())
  const eventCardRefs = useRef(new Map<string, HTMLElement>())
  const [connectorPaths, setConnectorPaths] = useState<{ path: string; color: string }[]>([])
  const [connectorSize, setConnectorSize] = useState({ width: 0, height: 0 })
  const [connectorClipTop, setConnectorClipTop] = useState(0)
  const [connectorClipBottom, setConnectorClipBottom] = useState(0)
  const channelsLoading = Boolean(projectDirectory) && loadedChannelsDirectory !== projectDirectory && !channelsLoadError
  const vodsLoading = Boolean(projectDirectory) && loadedVodsDirectory !== projectDirectory && !vodsLoadError
  const eventsLoading = Boolean(projectDirectory) && loadedEventsDirectory !== projectDirectory && !eventsLoadError

  useLayoutEffect(() => {
    const tracks = tracksRef.current
    if (!tracks) return

    let frame: number | null = null
    const updateConnectors = () => {
      frame = null
      const tracksRect = tracks.getBoundingClientRect()
      setConnectorSize({ width: tracks.clientWidth, height: tracks.clientHeight })
      const eventScroll = tracks.querySelector('.all-events .event-scroll')
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
  }, [events, vods, splitAllocations, eventsLoading])

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
      .then((storedEvents) => {
        if (isCurrent) {
          setEvents(sortEventsNewestFirst(storedEvents))
          setLoadedEventsDirectory(projectDirectory)
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
    const directory = directoryDraft.trim()

    if (!isWindowsDirectory(directory)) {
      setDirectoryError('Enter an absolute Windows path, such as C:\\LoreManor.')
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
    setProjectDirectory(directory)
    setSettingsOpen(false)
  }

  const clearProjectDirectory = () => {
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
    if (!projectDirectory || extractingVideoID) return
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
      setEvents((currentEvents) => sortEventsNewestFirst([
        ...currentEvents.filter((event) => !(event.sourceType === 'VOD' && event.vodId === vod.videoID)),
        ...result.events,
      ]))
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

  const reorderEvent = (targetEventId: string) => {
    if (!draggedEventId || draggedEventId === targetEventId) return

    const draggedEvent = events.find((event) => event.eventID === draggedEventId)
    const targetEvent = events.find((event) => event.eventID === targetEventId)
    if (!draggedEvent || !targetEvent) return
    if (draggedEvent.sourceType !== 'manual' || targetEvent.sourceType !== 'manual') return

    setEvents((currentEvents) => {
      const reordered = [...currentEvents]
      const fromIndex = reordered.findIndex((event) => event.eventID === draggedEventId)
      const toIndex = reordered.findIndex((event) => event.eventID === targetEventId)
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, moved)
      return reordered
    })
  }

  const renderEventCard = (event: LoreEvent, isPrimary = false, trackName = 'all') => {
    const vod = event.vodId ? vods.find((candidate) => candidate.videoID === event.vodId) : undefined
    return (
      <article
        key={event.eventID}
        ref={(element) => {
          const cardKey = `${event.eventID}:${trackName}`
          if (element) eventCardRefs.current.set(cardKey, element)
          else eventCardRefs.current.delete(cardKey)
        }}
        className="event-card"
        style={event.sourceType === 'VOD' && event.vodId
          ? { borderLeft: `4px solid ${getVodColor(event.vodId)}` }
          : undefined}
        draggable={isPrimary && event.sourceType === 'manual'}
        onDragStart={isPrimary ? () => setDraggedEventId(event.eventID) : undefined}
        onDragEnd={isPrimary ? () => setDraggedEventId(null) : undefined}
        onDragOver={isPrimary ? (dragEvent) => dragEvent.preventDefault() : undefined}
        onDrop={isPrimary ? () => reorderEvent(event.eventID) : undefined}
      >
        {vod?.thumbnailURL && (
          <img className="event-card-thumbnail" src={vod.thumbnailURL} alt="" loading="lazy" />
        )}
        <span>{event.description}</span>
      </article>
    )
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/src/assets/lore-manor-icon.svg" alt="" />
          <span>Lore Manor</span>
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
                      disabled={!projectDirectory || Boolean(extractingVideoID) || eventsLoading}
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
                className={`view-toggle ${splitAllocations ? 'active' : ''}`}
                type="button"
                onClick={() => setSplitAllocations((split) => !split)}
                aria-pressed={splitAllocations}
              >
                <span aria-hidden="true">▦</span>
                Allocation tracks
              </button>
              <button className="add-event-button" type="button">
                <span aria-hidden="true">+</span>
                Add event
              </button>
            </div>
          </div>

          <div className={`events-content ${splitAllocations ? 'split' : ''}`}>
            <div className="allocation-column all-events">
              <div className="allocation-header">
                <span>All events</span>
                <span className="count">{events.length}</span>
              </div>
              <div
                className="track-scroll event-scroll"
                onDragOver={(event) => event.preventDefault()}
              >
                {eventsLoading ? (
                  <div className="empty-state events-empty"><p>Loading events…</p></div>
                ) : eventsLoadError ? (
                  <div className="empty-state events-empty"><p className="field-error" role="alert">{eventsLoadError}</p></div>
                ) : events.length === 0 ? (
                  <div className="empty-state events-empty">
                    <div className="empty-icon timeline-icon" aria-hidden="true">⋮</div>
                    <h2>No events</h2>
                    <p>Extracted moments and manually added events will appear here.</p>
                  </div>
                ) : (
                  events.map((event) => renderEventCard(event, true))
                )}
              </div>
            </div>

            {splitAllocations && (
              <>
                {(['Story', 'Devlog'] as const).map((trackName) => (
                  <div className="allocation-column" key={trackName}>
                    <div className="allocation-header">
                      <span>{trackName}</span>
                      <span className="count">
                        {events.filter((event) => event.allocatedTracks.includes(trackName)).length}
                      </span>
                    </div>
                    <div className="track-scroll event-scroll">
                      {events.filter((event) => event.allocatedTracks.includes(trackName)).length === 0 ? (
                        <div className="allocation-empty">No {trackName.toLowerCase()} allocations</div>
                      ) : (
                        events
                          .filter((event) => event.allocatedTracks.includes(trackName))
                          .map((event) => renderEventCard(event, false, trackName))
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
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
                <button className="clear-button" type="button" onClick={clearProjectDirectory} disabled={!projectDirectory}>Clear</button>
                <button className="save-button" type="submit">Save directory</button>
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
