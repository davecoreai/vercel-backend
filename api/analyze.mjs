import { timingSafeEqual } from 'node:crypto';

const DEFAULT_MODEL = 'gemini-3.5-flash';
const MAX_PROMPT_LENGTH = 12_000;
const MAX_OPTIONS = 20;

function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizedModel(value) {
  const model = typeof value === 'string' ? value.trim() : DEFAULT_MODEL;
  return /^[a-zA-Z0-9._-]{1,100}$/.test(model) ? model : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed', message: 'Gunakan metode POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const appToken = process.env.APP_TOKEN?.trim();
  const model = normalizedModel(process.env.GEMINI_MODEL || DEFAULT_MODEL);

  if (!apiKey) {
    console.error('Missing GEMINI_API_KEY environment variable.');
    return json(res, 500, { error: 'server_misconfigured', message: 'Backend belum dikonfigurasi dengan Gemini API key.' });
  }
  if (!appToken || appToken.length < 24) {
    console.error('Missing or weak APP_TOKEN environment variable.');
    return json(res, 500, { error: 'server_misconfigured', message: 'Backend belum dikonfigurasi dengan APP_TOKEN yang kuat.' });
  }
  if (!model) {
    console.error('Invalid GEMINI_MODEL environment variable.');
    return json(res, 500, { error: 'server_misconfigured', message: 'Nilai GEMINI_MODEL tidak valid.' });
  }

  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!safeEqual(suppliedToken, appToken)) {
    return json(res, 401, { error: 'unauthorized', message: 'Token backend tidak valid.' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(res, 400, { error: 'invalid_body', message: 'Body harus berupa JSON object.' });
  }

  const question = body.question;
  const prompt = typeof question?.prompt === 'string' ? question.prompt.trim() : '';
  if (!prompt) return json(res, 400, { error: 'missing_prompt', message: 'question.prompt wajib diisi.' });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return json(res, 413, { error: 'prompt_too_long', message: 'Soal terlalu panjang; batasnya 12.000 karakter.' });
  }

  const safeInput = {
    prompt,
    type: typeof question.type === 'string' ? question.type.slice(0, 100) : 'AUTO',
    options: Array.isArray(question.options)
      ? question.options.slice(0, MAX_OPTIONS).filter((item) => typeof item === 'string').map((item) => item.slice(0, 1_000))
      : []
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: [
              'Kamu adalah asisten belajar berbahasa Indonesia.',
              'Bantu pengguna memahami konsep dan latihan yang memang mengizinkan bantuan AI.',
              'Jika konteks menyebut ujian aktif, ujian terawasi, proctoring, atau bantuan AI dilarang, jangan berikan jawaban langsung; berikan penjelasan konsep umum saja.',
              'Jangan mengarang informasi ketika soal tidak lengkap. Sebutkan asumsi atau minta klarifikasi di dalam penjelasan.',
              'Kembalikan hanya JSON valid berbentuk {"answer":"...","explanation":"...","confidence":"LOW|MEDIUM|HIGH"}.',
              'Confidence bersifat kualitatif, bukan probabilitas terkalibrasi.'
            ].join(' ')}]
          },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(safeInput) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 700
          }
        }),
        signal: AbortSignal.timeout(25_000)
      }
    );

    const providerBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Do not expose provider error bodies, request content, or secret values to clients.
      console.error('Gemini API returned HTTP status:', response.status);
      return json(res, 502, {
        error: 'provider_error',
        message: 'Gemini gagal memproses permintaan. Periksa model, API key, kuota, dan akses project.'
      });
    }

    const text = (providerBody.candidates?.[0]?.content?.parts || [])
      .map((part) => typeof part.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n');
    if (!text) {
      console.error('Gemini returned an empty candidate.');
      return json(res, 502, { error: 'empty_response', message: 'Gemini mengembalikan respons kosong.' });
    }

    const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let result;
    try {
      result = JSON.parse(normalized);
    } catch {
      console.error('Gemini returned non-JSON output.');
      return json(res, 502, { error: 'invalid_ai_json', message: 'Format respons Gemini tidak valid.' });
    }

    const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
    const explanation = typeof result.explanation === 'string' ? result.explanation.trim() : '';
    const rawConfidence = String(result.confidence || 'LOW').toUpperCase();
    const confidence = ['LOW', 'MEDIUM', 'HIGH'].includes(rawConfidence) ? rawConfidence : 'LOW';
    if (!answer) {
      return json(res, 502, { error: 'missing_answer', message: 'Gemini tidak mengembalikan saran jawaban.' });
    }

    // Deliberately never log the user's question or the AI response.
    return json(res, 200, { answer, explanation, confidence, model });
  } catch (error) {
    console.error('Gemini request failed:', error?.name || 'unknown error');
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return json(res, 502, {
      error: timedOut ? 'provider_timeout' : 'request_failed',
      message: timedOut ? 'Gemini terlalu lama merespons. Coba lagi.' : 'Backend gagal menghubungi Gemini API.'
    });
  }
}
