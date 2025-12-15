export default function handler(req, res) {
  res.status(200).json({ 
    message: 'Hello from Vercel!',
    time: new Date().toISOString(),
    hasDb: !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL)
  });
}
