import { list, get } from '@vercel/blob';

function checkAuth(request) {
  const provided = request.headers['x-admin-password'];
  return provided && process.env.ADMIN_PASSWORD && provided === process.env.ADMIN_PASSWORD;
}

async function fetchMetaJson(pathname) {
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  try {
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(request, response) {
  if (!checkAuth(request)) {
    return response.status(401).json({ error: 'Mot de passe incorrect.' });
  }

  try {
    const groups = {};
    let cursor;
    do {
      const page = await list({ prefix: 'submissions/', limit: 1000, cursor });
      for (const b of page.blobs) {
        const parts = b.pathname.split('/'); // submissions/<id>/<file>
        const id = parts[1];
        if (!id) continue;
        groups[id] = groups[id] || { id, files: [] };
        if (parts[2] === 'meta.json') {
          groups[id].metaPathname = b.pathname;
        } else {
          groups[id].files.push({
            pathname: b.pathname,
            docType: parts[2] ? parts[2].split('__')[0] : 'inconnu',
            size: b.size,
            uploadedAt: b.uploadedAt,
            contentType: b.contentType,
          });
        }
      }
      cursor = page.cursor;
    } while (cursor);

    const results = await Promise.all(
      Object.values(groups).map(async (g) => {
        const meta = g.metaPathname ? await fetchMetaJson(g.metaPathname) : null;
        return { id: g.id, meta, files: g.files };
      })
    );

    results.sort((a, b) => (b.meta?.submittedAt || '').localeCompare(a.meta?.submittedAt || ''));

    return response.status(200).json({ submissions: results });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Erreur serveur.' });
  }
}
