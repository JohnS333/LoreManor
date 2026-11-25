import cors from 'cors'
import express from 'express'
import { eventsRouter } from './routes/events.js'
import { healthRouter } from './routes/health.js'
import { persistenceRouter } from './routes/persistence.js'

const app = express()
const port = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json())
app.use('/api', healthRouter)
app.use('/api', eventsRouter)
app.use('/api', persistenceRouter)

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error)
  response.status(500).json({ error: 'The server operation failed.' })
})

app.listen(port, () => {
  console.log(`LoreManor API listening on http://localhost:${port}`)
})
