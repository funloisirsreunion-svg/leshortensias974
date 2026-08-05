import { del } from '@vercel/blob';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const { pathname } = request.body || {};
  if (
    !pathname ||
    typeof pathname !== 'string' ||
    !/^submissions\/[a-zA-Z0-9-]{10,80}\/[a-zA-Z0-9_.\-]+$/.test(pathname) ||
    pathname.endsWith('meta.json')
  ) {
    return response.status(400).json({ error: 'Chemin invalide.' });
  }

  try {
    await del(pathname);
    return response.status(200).json({ ok: true });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Échec de la suppression.' });
  }
}
