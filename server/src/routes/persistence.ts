import { Router } from 'express'
import {
  isPersistenceCollection,
  loadCollection,
  PersistenceValidationError,
  saveCollection,
} from '../services/persistence.js'

export const persistenceRouter = Router()

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
