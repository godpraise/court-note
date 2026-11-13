// /api/clean-note — 코트노트 "AI로 메모 정리" 기능의 서버 쪽 함수
//
// 클라이언트(index.html)가 로그인 시 받은 Firebase ID 토큰을 Authorization 헤더로
// 함께 보내면, 이 함수가 그 토큰이 진짜 우리 코치님 계정인지 확인한 다음에만
// Anthropic(Claude) API를 대신 호출해요. Claude API 키는 여기(서버) 환경변수에만
// 있고, 브라우저 쪽 코드에는 절대 들어가지 않아요.

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}

const SYSTEM_PROMPT =
  '다음은 피클볼 코치가 수업 직후 남긴 짧은 메모입니다. 이 메모를 "오늘 배운 내용 / 관찰(잘된 점·보완할 점) / 다음 수업 메모" ' +
  '세 줄로 간결하게 정리해주세요. 메모에 없는 내용(과제, 성과 등)은 추가하지 말고, 다른 설명 없이 정리된 세 줄만 답하세요.';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  // 1. 로그인 확인 — 코치님 본인 계정으로 로그인된 요청만 통과시켜요.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'missing_token' });
    return;
  }
  let identity;
  try {
    getAdminApp();
    identity = await getAuth().verifyIdToken(token, true);
  } catch (err) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  // A valid Firebase identity alone does not authorize a paid AI request.
  if (!identity.email || identity.email_verified !== true) {
    res.status(403).json({ error: 'coach_not_authorized' });
    return;
  }
  try {
    const coach = await getFirestore(getAdminApp()).collection('admins').doc(identity.email).get();
    if (!coach.exists) {
      res.status(403).json({ error: 'coach_not_authorized' });
      return;
    }
  } catch (err) {
    res.status(503).json({ error: 'authorization_unavailable' });
    return;
  }

  // 2. 입력 확인
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'empty_text' });
    return;
  }
  if (text.length > 4000) {
    res.status(400).json({ error: 'text_too_long' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }

  // 3. Claude API 호출
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [
          { role: 'user', content: SYSTEM_PROMPT + '\n\n메모: ' + text },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error', anthropicRes.status, errText);
      res.status(502).json({ error: 'anthropic_error' });
      return;
    }

    const data = await anthropicRes.json();
    const cleaned = (data.content || [])
      .map((c) => (c && c.type === 'text' ? c.text : ''))
      .join('')
      .trim();

    res.status(200).json({ text: cleaned });
  } catch (err) {
    console.error('clean-note handler error', err);
    res.status(500).json({ error: 'server_error' });
  }
};
