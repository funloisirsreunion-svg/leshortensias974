import { Readable } from 'node:stream';
import { list, del, get } from '@vercel/blob';

// Fusion de list/download/purge (anciens outils de l'espace admin-dossiers.html,
// stockage Vercel Blob des inscriptions colonies) en une seule fonction routée par
// ?action=... — nécessaire pour rester sous la limite de 12 fonctions serverless
// du plan Vercel Hobby une fois la plateforme Écoles/Admin (Supabase) ajoutée.

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

async function handleList(request, response) {
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
}

async function handleDownload(request, response) {
  const pathname = request.query.pathname;
  if (!pathname || typeof pathname !== 'string' || !pathname.startsWith('submissions/') || pathname.endsWith('meta.json')) {
    return response.status(400).json({ error: 'Chemin invalide.' });
  }
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
}

async function handlePurge(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }
  const monthsOld = Number(request.body?.monthsOld) || 24;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsOld);

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
}

export default async function handler(request, response) {
  if (!checkAuth(request)) {
    return response.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  const action = request.query.action || 'list';
  try {
    if (action === 'download') return await handleDownload(request, response);
    if (action === 'purge') return await handlePurge(request, response);
    return await handleList(request, response);
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Erreur serveur.' });
  }
}
