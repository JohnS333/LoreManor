import type {
  ApiHealth,
  PersistedData,
  PersistenceCollection,
  SavePersistenceRequest,
  SavePersistenceResponse,
} from '../../../shared/types/api'

export async function getApiHealth(): Promise<ApiHealth> {
  const response = await fetch('/api/health')

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`)
  }

  return response.json() as Promise<ApiHealth>
}

export async function loadChannels(projectDirectory: string): Promise<PersistedData['channels']> {
  const query = new URLSearchParams({ projectDirectory })
  const response = await fetch(`/api/persistence/channels?${query}`)

  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null
    const message = typeof result?.error === 'string' ? result.error : `API request failed with status ${response.status}`
    throw new Error(message)
  }

  return response.json() as Promise<PersistedData['channels']>
}

export async function savePersistenceCollection<K extends PersistenceCollection>(
  collection: K,
  projectDirectory: string,
  data: PersistedData[K],
): Promise<SavePersistenceResponse> {
  const body: SavePersistenceRequest<K> = { projectDirectory, data }
  const response = await fetch(`/api/persistence/${collection}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null
    const message = typeof result?.error === 'string' ? result.error : `API request failed with status ${response.status}`
    throw new Error(message)
  }

  return response.json() as Promise<SavePersistenceResponse>
}

export const saveChannels = (projectDirectory: string, data: PersistedData['channels']) =>
  savePersistenceCollection('channels', projectDirectory, data)

export const saveVods = (projectDirectory: string, data: PersistedData['vods']) =>
  savePersistenceCollection('vods', projectDirectory, data)

export const saveEvents = (projectDirectory: string, data: PersistedData['events']) =>
  savePersistenceCollection('events', projectDirectory, data)

export const saveAllocationTracks = (projectDirectory: string, data: PersistedData['allocationTracks']) =>
  savePersistenceCollection('allocationTracks', projectDirectory, data)

export const saveProjects = (projectDirectory: string, data: PersistedData['projects']) =>
  savePersistenceCollection('projects', projectDirectory, data)
