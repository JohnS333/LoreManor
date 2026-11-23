export type ApiHealth = {
  status: 'ok'
  service: string
}

export type Channel = {
  channelURL: string
  channelName: string
}

export type Vod = {
  videoID: string
  videoURL: string
  datetime: string
  vodTitle: string
  thumbnailURL: string
}

export type EventSourceType = 'VOD' | 'manual' | 'Discord'

export type AllocationTrack = 'Story' | 'Devlog' | (string & {})

export type LoreEvent = {
  eventID: string
  sourceType: EventSourceType
  vodId: string | null
  datetime: string
  starttime: string
  endtime: string
  description: string
  shortsViable: boolean
  allocatedTracks: AllocationTrack[]
  projectAllocations: string[]
}

export type VideoProject = {
  projectID: string
  projectName: string
  projectType: 'Storyline' | 'Devlog'
  eventIDs: string[]
}

export type PersistedData = {
  channels: Channel[]
  vods: Vod[]
  events: LoreEvent[]
  allocationTracks: AllocationTrack[]
  projects: VideoProject[]
}

export type PersistenceCollection = keyof PersistedData

export type SavePersistenceRequest<K extends PersistenceCollection = PersistenceCollection> = {
  projectDirectory: string
  data: PersistedData[K]
}

export type SavePersistenceResponse = {
  collection: PersistenceCollection
  fileName: string
  itemCount: number
  savedAt: string
}
