import { randomUUID } from 'node:crypto'
import { readFile, stat, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AllocationTrack,
  Channel,
  LoreEvent,
  PersistedData,
  PersistenceCollection,
  SavePersistenceResponse,
  VideoProject,
  Vod,
} from '../../../shared/types/api.js'

const FILE_NAMES: Record<PersistenceCollection, string> = {
  channels: 'channels.json',
  vods: 'vods.json',
  events: 'events.json',
  allocationTracks: 'allocation-tracks.json',
  projects: 'projects.json',
}

const pendingWrites = new Map<string, Promise<void>>()

export class PersistenceValidationError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isChannel = (value: unknown): value is Channel =>
  isRecord(value) && typeof value.channelURL === 'string' && typeof value.channelName === 'string'

const isVod = (value: unknown): value is Vod =>
  isRecord(value) &&
  typeof value.videoID === 'string' &&
  typeof value.videoURL === 'string' &&
  typeof value.datetime === 'string' &&
  typeof value.vodTitle === 'string' &&
  typeof value.thumbnailURL === 'string'

const isLoreEvent = (value: unknown): value is LoreEvent =>
  isRecord(value) &&
  typeof value.eventID === 'string' &&
  (value.sourceType === 'VOD' || value.sourceType === 'manual' || value.sourceType === 'Discord') &&
  (typeof value.vodId === 'string' || value.vodId === null) &&
  (typeof value.datetime === 'string' || value.datetime === null) &&
  typeof value.starttime === 'string' &&
  typeof value.endtime === 'string' &&
  typeof value.description === 'string' &&
  (typeof value.shortsViable === 'boolean' || value.shortsViable === null) &&
  isStringArray(value.allocatedTracks) &&
  isStringArray(value.projectAllocations)

const isAllocationTrack = (value: unknown): value is AllocationTrack =>
  typeof value === 'string' && value.trim().length > 0

const isVideoProject = (value: unknown): value is VideoProject =>
  isRecord(value) &&
  typeof value.projectID === 'string' &&
  typeof value.projectName === 'string' &&
  (value.projectType === 'Storyline' || value.projectType === 'Devlog') &&
  isStringArray(value.eventIDs)

const validators: { [K in PersistenceCollection]: (value: unknown) => value is PersistedData[K][number] } = {
  channels: isChannel,
  vods: isVod,
  events: isLoreEvent,
  allocationTracks: isAllocationTrack,
  projects: isVideoProject,
}

export const isPersistenceCollection = (value: string): value is PersistenceCollection =>
  Object.hasOwn(FILE_NAMES, value)

export const validateProjectDirectory = async (projectDirectory: unknown) => {
  if (typeof projectDirectory !== 'string' || !path.win32.isAbsolute(projectDirectory)) {
    throw new PersistenceValidationError('projectDirectory must be an absolute Windows path.')
  }

  let directoryStats
  try {
    directoryStats = await stat(projectDirectory)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      throw new PersistenceValidationError('The project directory does not exist.')
    }
    throw error
  }

  if (!directoryStats.isDirectory()) {
    throw new PersistenceValidationError('The project directory path is not a directory.')
  }

  return path.win32.normalize(projectDirectory)
}

const validateData = <K extends PersistenceCollection>(collection: K, data: unknown): PersistedData[K] => {
  if (!Array.isArray(data) || !data.every(validators[collection])) {
    throw new PersistenceValidationError(`Invalid data for ${collection}.`)
  }
  return data as PersistedData[K]
}

const writeAtomically = async (filePath: string, data: unknown) => {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`

  try {
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch((cleanupError: unknown) => {
      if (!isRecord(cleanupError) || cleanupError.code !== 'ENOENT') throw cleanupError
    })
    throw error
  }
}

const enqueueWrite = async (filePath: string, data: unknown) => {
  const previousWrite = pendingWrites.get(filePath) ?? Promise.resolve()
  const currentWrite = previousWrite.catch(() => undefined).then(() => writeAtomically(filePath, data))
  pendingWrites.set(filePath, currentWrite)

  try {
    await currentWrite
  } finally {
    if (pendingWrites.get(filePath) === currentWrite) pendingWrites.delete(filePath)
  }
}

export async function saveCollection<K extends PersistenceCollection>(
  collection: K,
  projectDirectory: unknown,
  data: unknown,
): Promise<SavePersistenceResponse> {
  const directory = await validateProjectDirectory(projectDirectory)
  const validatedData = validateData(collection, data)
  const fileName = FILE_NAMES[collection]
  await enqueueWrite(path.win32.join(directory, fileName), validatedData)

  return {
    collection,
    fileName,
    itemCount: validatedData.length,
    savedAt: new Date().toISOString(),
  }
}

export async function loadCollection<K extends PersistenceCollection>(
  collection: K,
  projectDirectory: unknown,
): Promise<PersistedData[K]> {
  const directory = await validateProjectDirectory(projectDirectory)
  const filePath = path.win32.join(directory, FILE_NAMES[collection])
  let contents: string

  try {
    contents = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return [] as PersistedData[K]
    throw error
  }

  let data: unknown
  try {
    data = JSON.parse(contents.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(`Persisted file ${FILE_NAMES[collection]} contains invalid JSON.`)
  }

  if (!Array.isArray(data) || !data.every(validators[collection])) {
    throw new Error(`Persisted file ${FILE_NAMES[collection]} has an invalid data format.`)
  }

  return data as PersistedData[K]
}

export const saveChannels = (projectDirectory: unknown, data: unknown) =>
  saveCollection('channels', projectDirectory, data)

export const saveVods = (projectDirectory: unknown, data: unknown) =>
  saveCollection('vods', projectDirectory, data)

export const saveEvents = (projectDirectory: unknown, data: unknown) =>
  saveCollection('events', projectDirectory, data)

export const saveAllocationTracks = (projectDirectory: unknown, data: unknown) =>
  saveCollection('allocationTracks', projectDirectory, data)

export const saveProjects = (projectDirectory: unknown, data: unknown) =>
  saveCollection('projects', projectDirectory, data)
