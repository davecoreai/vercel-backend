const DEFAULT_MODEL = 'gemini-3.5-flash';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed', message: 'Gunakan metode GET.' });
  }

  return res.status(200).json({
    ok: true,
    service: 'FloatixBot Gemini API',
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    configured: Boolean(process.env.GEMINI_API_KEY && process.env.APP_TOKEN)
  });
}
