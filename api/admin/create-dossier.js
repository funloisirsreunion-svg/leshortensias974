import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { assignClsNumber } from '../../lib/clsDossierNumber.js';

const PROGRAMMES = new Set(['nature', 'volcan']);
const DUREES = new Set([3, 4, 5]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await requireAdmin(req);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const body = req.body || {};
  const etablissement = typeof body.etablissement === 'string' ? body.etablissement.trim() : '';
  if (!etablissement) {
    return res.status(400).json({ error: 'Le nom de l\'établissement est obligatoire.' });
  }
  if (body.programme && !PROGRAMMES.has(body.programme)) {
    return res.status(400).json({ error: 'Programme invalide (nature ou volcan).' });
  }
  if (body.duree && !DUREES.has(Number(body.duree))) {
    return res.status(400).json({ error: 'Durée invalide (3, 4 ou 5 jours).' });
  }

  try {
    const numero = await assignClsNumber();
    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from('dossiers')
      .insert({
        numero,
        etablissement,
        commune: body.commune || null,
        adresse: body.adresse || null,
        contact_nom: body.contact_nom || null,
        contact_telephone: body.contact_telephone || null,
        contact_email: body.contact_email || null,
        programme: body.programme || null,
        duree: body.duree ? Number(body.duree) : null,
        periode_souhaitee: body.periode_souhaitee || null,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ dossier: data });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Échec de la création du dossier.' });
  }
}
