import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import {
  isPersistenceCollection,
  loadCollection,
  PersistenceValidationError,
  saveCollection,
} from '../services/persistence.js'
import { fetchYoutubeVods, YoutubeFetchError, YoutubeFetchValidationError } from '../services/youtube.js'

export const persistenceRouter = Router()

persistenceRouter.post('/vods/fetch', async (request, response, next) => {
  const { projectDirectory, channelURL } = request.body ?? {}
  const fetchId = randomUUID().slice(0, 8)
  const log = (message: string) => console.info(`[VOD fetch ${fetchId}] ${message}`)

  try {
    log('Loading saved VODs.')
    const savedVods = await loadCollection('vods', projectDirectory)
    if (typeof channelURL !== 'string') {
      log('Rejected request: channelURL must be a YouTube channel URL.')
      response.status(400).json({ error: 'channelURL must be a YouTube channel URL.' })
      return
    }

    log(`Loaded ${savedVods.length} saved VODs. Starting yt-dlp metadata extraction.`)
    const fetchedVods = await fetchYoutubeVods(channelURL, (count, vod) => {
      log(`Retrieved metadata for VOD ${count}: ${vod.vodTitle}`)
    })
    log(`Metadata extraction finished: ${fetchedVods.length} VODs found.`)
    const existingVods = await loadCollection('vods', projectDirectory)
    const existingIds = new Set(existingVods.map((vod) => vod.videoID))
    const mergedVods = new Map(existingVods.map((vod) => [vod.videoID, vod]))
    fetchedVods.forEach((vod) => mergedVods.set(vod.videoID, vod))
    const addedCount = fetchedVods.filter((vod) => !existingIds.has(vod.videoID)).length
    const vods = [...mergedVods.values()].sort((first, second) =>
      (Date.parse(second.datetime) || 0) - (Date.parse(first.datetime) || 0),
    )
    log(`Merged results: ${addedCount} new VODs; ${vods.length} total.`)
    log('Saving vods.json.')
    await saveCollection('vods', projectDirectory, vods)
    log('Saved vods.json successfully.')
    response.json({
      vods,
      addedCount,
      totalCount: vods.length,
    })
  } catch (error) {
    if (error instanceof PersistenceValidationError || error instanceof YoutubeFetchValidationError) {
      log(`Request rejected: ${error.message}`)
      response.status(400).json({ error: error.message })
      return
    }
    if (error instanceof YoutubeFetchError) {
      console.error(`[VOD fetch ${fetchId}] ${error.message}`)
      response.status(502).json({ error: error.message })
      return
    }
    next(error)
  }
})

persistenceRouter.get('/persistence/:collection', async (request, response, next) => {
  const collection = request.params.collection
  if (!isPersistenceCollection(collection)) {
    response.status(404).json({ error: 'Unknown persistence collection.' })
    return
  }

  try {
    const data = await loadCollection(collection, request.query.projectDirectory)
    response.json(data)
  } catch (error) {
    if (error instanceof PersistenceValidationError) {
      response.status(400).json({ error: error.message })
      return
    }
    next(error)
  }
})

persistenceRouter.put('/persistence/:collection', async (request, response, next) => {
  const collection = request.params.collection
  if (!isPersistenceCollection(collection)) {
    response.status(404).json({ error: 'Unknown persistence collection.' })
    return
  }

  try {
    const result = await saveCollection(collection, request.body?.projectDirectory, request.body?.data)
    response.json(result)
  } catch (error) {
    if (error instanceof PersistenceValidationError) {
      response.status(400).json({ error: error.message })
      return
    }
    next(error)
  }
})
