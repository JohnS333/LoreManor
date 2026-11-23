import { useEffect, useState, type FormEvent } from 'react'
import type { Channel, LoreEvent, Vod } from '../../shared/types/api'
import { loadChannels, saveChannels } from './services/api'
import './App.css'

const PROJECT_DIRECTORY_STORAGE_KEY = 'loreManor.projectDirectory'

const getStoredProjectDirectory = () => localStorage.getItem(PROJECT_DIRECTORY_STORAGE_KEY) ?? ''

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
  const [vods] = useState<Vod[]>([])
  const [events, setEvents] = useState<LoreEvent[]>([])
  const [splitAllocations, setSplitAllocations] = useState(true)
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null)
  const [projectDirectory, setProjectDirectory] = useState(getStoredProjectDirectory)
  const [directoryDraft, setDirectoryDraft] = useState(projectDirectory)
  const [directoryError, setDirectoryError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [channelFormOpen, setChannelFormOpen] = useState(false)
  const [channelUrlDraft, setChannelUrlDraft] = useState('')
  const [channelNameDraft, setChannelNameDraft] = useState('')
  const [channelError, setChannelError] = useState('')
  const [loadedChannelsDirectory, setLoadedChannelsDirectory] = useState('')
  const [channelsLoadError, setChannelsLoadError] = useState('')
  const [channelSaving, setChannelSaving] = useState(false)
  const channelsLoading = Boolean(projectDirectory) && loadedChannelsDirectory !== projectDirectory && !channelsLoadError

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

  const openSettings = () => {
    setDirectoryDraft(projectDirectory)
    setDirectoryError('')
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
    setLoadedChannelsDirectory('')
    setChannelsLoadError('')
    setProjectDirectory(directory)
    setSettingsOpen(false)
  }

  const clearProjectDirectory = () => {
    localStorage.removeItem(PROJECT_DIRECTORY_STORAGE_KEY)
    setProjectDirectory('')
    setChannels([])
    setLoadedChannelsDirectory('')
    setChannelsLoadError('')
    setDirectoryDraft('')
    setDirectoryError('')
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

      <div className="tracks">
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
              <button className="icon-button refresh-button" type="button" aria-label="Fetch VODs">↻</button>
            </div>
          </div>
          <div className="track-scroll empty-scroll">
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <span className="play-icon">▶</span>
              </div>
              <h2>No VODs yet</h2>
              <p>Add a channel, then fetch its available videos.</p>
            </div>
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
                {events.length === 0 ? (
                  <div className="empty-state events-empty">
                    <div className="empty-icon timeline-icon" aria-hidden="true">⋮</div>
                    <h2>No events</h2>
                    <p>Extracted moments and manually added events will appear here.</p>
                  </div>
                ) : (
                  events.map((event) => (
                    <article
                      key={event.eventID}
                      className="event-card"
                      draggable={event.sourceType === 'manual'}
                      onDragStart={() => setDraggedEventId(event.eventID)}
                      onDragEnd={() => setDraggedEventId(null)}
                      onDragOver={(dragEvent) => dragEvent.preventDefault()}
                      onDrop={() => reorderEvent(event.eventID)}
                    >
                      {event.description}
                    </article>
                  ))
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
                          .map((event) => (
                            <article key={event.eventID} className="event-card">
                              {event.description}
                            </article>
                          ))
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
