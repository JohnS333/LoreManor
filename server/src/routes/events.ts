import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { EventExtractionError, EventExtractionValidationError, extractEventsForVod } from '../services/eventExtraction.js'
import { PersistenceValidationError } from '../services/persistence.js'

export const eventsRouter = Router()

eventsRouter.post('/events/fetch', async (request, response, next) => {
  const { projectDirectory, vod, geminiApiKey } = request.body ?? {}
  const extractionId = randomUUID().slice(0, 8)
  const log = (message: string) => console.info(`[Event extraction ${extractionId}] ${message}`)

  log('Starting VOD event extraction.')
  try {
    const result = await extractEventsForVod(projectDirectory, vod, geminiApiKey, log)
    log('Event extraction completed successfully.')
    response.setHeader('Access-Control-Expose-Headers', 'X-Transcript-Reused')
    response.setHeader('X-Transcript-Reused', String(result.transcriptReused))
    response.json(result.events)
  } catch (error) {
    log(`Failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    if (
      error instanceof PersistenceValidationError ||
      error instanceof EventExtractionValidationError
    ) {
      response.status(400).json({ error: error.message })
      return
    }
    if (error instanceof EventExtractionError) {
      response.status(502).json({ error: error.message })
      return
    }
    next(error)
  }
})
