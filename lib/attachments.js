import { get, issueSignedToken, presignUrl } from '@vercel/blob';

const MAX_TOTAL_EMAIL_BYTES = 25 * 1024 * 1024;
const LINK_VALID_MS = 72 * 60 * 60 * 1000; // 72h

async function fetchBlobBuffer(pathname) {
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const arrayBuf = await new Response(result.stream).arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function buildLink(pathname) {
  const validUntil = Date.now() + LINK_VALID_MS;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil });
  return presignedUrl;
}

// items: [{ pathname, size, filename }] — retourne { attachments: [{filename, content(base64)}], links: [{filename,url}] }
// Tasse le plus de fichiers possible sous la limite totale (du plus petit au plus grand),
// les fichiers restants reçoivent un lien signé temporaire plutôt que d'être exclus silencieusement.
export async function buildAttachmentsOrLinks(items) {
  const sorted = [...items].sort((a, b) => (a.size || 0) - (b.size || 0));
  let total = 0;
  const attachments = [];
  const links = [];

  for (const item of sorted) {
    const size = item.size || 0;
    if (total + size <= MAX_TOTAL_EMAIL_BYTES) {
      const buf = await fetchBlobBuffer(item.pathname);
      if (!buf) {
        links.push({ filename: item.filename, url: await buildLink(item.pathname) });
        continue;
      }
      attachments.push({ filename: item.filename, content: buf.toString('base64') });
      total += size;
    } else {
      links.push({ filename: item.filename, url: await buildLink(item.pathname) });
    }
  }

  return { attachments, links };
}
