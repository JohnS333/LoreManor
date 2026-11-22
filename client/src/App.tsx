import { useState } from 'react'
import type { Channel, LoreEvent, Vod } from '../../shared/types/api'
import './App.css'

function App() {
  const [channels] = useState<Channel[]>([])
  const [vods] = useState<Vod[]>([])
  const [events, setEvents] = useState<LoreEvent[]>([])
  const [splitAllocations, setSplitAllocations] = useState(true)
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null)

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
          <div className="brand-mark" aria-hidden="true">LM</div>
          <span>LoreManor</span>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" type="button">
            <span className="folder-icon" aria-hidden="true">⌑</span>
            Projects
            <span className="count">0</span>
          </button>
          <button className="icon-button" type="button" aria-label="Settings">⚙</button>
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
          <button className="add-button" type="button">
            <span aria-hidden="true">+</span>
            Add channel
          </button>
          <div className="track-scroll empty-scroll">
            <div className="empty-state">
              <div className="empty-icon channel-icon" aria-hidden="true">◉</div>
              <h2>No channels</h2>
              <p>Add a YouTube channel to start loading VODs.</p>
            </div>
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
    </main>
  )
}

export default App
