import express from 'express'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes go here

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
