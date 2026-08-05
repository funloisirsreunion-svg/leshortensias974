import { list, del, get } from '@vercel/blob';

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
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }
  if (!checkAuth(request)) {
    return response.status(401).json({ error: 'Mot de passe incorrect.' });
  }

  const monthsOld = Number(request.body?.monthsOld) || 24;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsOld);

  try {
    const groups = {};
    let cursor;
    do {
      const page = await list({ prefix: 'submissions/', limit: 1000, cursor });
      for (const b of page.blobs) {
        const parts = b.pathname.split('/');
        const id = parts[1];
        if (!id) continue;
        groups[id] = groups[id] || { pathnames: [], metaPathname: null };
        if (parts[2] === 'meta.json') groups[id].metaPathname = b.pathname;
        groups[id].pathnames.push(b.pathname);
      }
      cursor = page.cursor;
    } while (cursor);

    const deleted = [];
    for (const [id, g] of Object.entries(groups)) {
      const meta = g.metaPathname ? await fetchMetaJson(g.metaPathname) : null;
      const submittedAt = meta?.submittedAt ? new Date(meta.submittedAt) : null;
      if (submittedAt && submittedAt < cutoff) {
        await Promise.all(g.pathnames.map((p) => del(p)));
        deleted.push(id);
      }
    }

    return response.status(200).json({ ok: true, deletedSubmissions: deleted });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Erreur serveur.' });
  }
}
