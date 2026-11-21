import cors from 'cors'
import express from 'express'
import { healthRouter } from './routes/health.js'

const app = express()
const port = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json())
app.use('/api', healthRouter)

app.listen(port, () => {
  console.log(`LoreManor API listening on http://localhost:${port}`)
})
