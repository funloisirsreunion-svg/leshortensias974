import { Readable } from 'node:stream';
import { get } from '@vercel/blob';

function checkAuth(request) {
  const provided = request.headers['x-admin-password'];
  return provided && process.env.ADMIN_PASSWORD && provided === process.env.ADMIN_PASSWORD;
}

export default async function handler(request, response) {
  if (!checkAuth(request)) {
    return response.status(401).json({ error: 'Mot de passe incorrect.' });
  }

  const pathname = request.query.pathname;
  if (!pathname || typeof pathname !== 'string' || !pathname.startsWith('submissions/') || pathname.endsWith('meta.json')) {
    return response.status(400).json({ error: 'Chemin invalide.' });
  }

  try {
    const result = await get(pathname, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return response.status(404).json({ error: 'Fichier introuvable.' });
    }

    const filename = pathname.split('/').pop().replace(/"/g, '');
    response.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');

    Readable.fromWeb(result.stream).pipe(response);
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Erreur serveur.' });
  }
}
