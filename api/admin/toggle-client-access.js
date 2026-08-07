import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';

// Désactive/réactive l'accès d'un enseignant à un dossier précis. Double
// verrou : bannissement Supabase Auth (bloque toute connexion) + statut
// dossier_acces='desactive' (bloque aussi l'accès RLS immédiatement, même
// si une session était déjà ouverte).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  try {
    await requireAdmin(req);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const { dossierId, userId, action } = req.body || {};
  if (!dossierId || !userId || !['disable', 'enable'].includes(action)) {
    return res.status(400).json({ error: 'Paramètres invalides.' });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: access, error: accessError } = await supabaseAdmin
    .from('dossier_acces').select('*').eq('dossier_id', dossierId).eq('profile_id', userId).maybeSingle();
  if (accessError || !access) {
    return res.status(404).json({ error: 'Accès introuvable pour ce dossier.' });
  }

  if (action === 'disable') {
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '87600h' });
    if (banError) return res.status(500).json({ error: 'Échec du blocage du compte : ' + banError.message });
    const { error: updError } = await supabaseAdmin.from('dossier_acces').update({ statut: 'desactive' }).eq('id', access.id);
    if (updError) return res.status(500).json({ error: updError.message });
    return res.status(200).json({ ok: true, statut: 'desactive' });
  }

  // action === 'enable'
  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userError) return res.status(500).json({ error: 'Échec de la récupération du compte : ' + userError.message });

  const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (unbanError) return res.status(500).json({ error: 'Échec de la réactivation du compte : ' + unbanError.message });

  const newStatut = userData.user.last_sign_in_at ? 'compte_active' : 'invitation_envoyee';
  const { error: updError } = await supabaseAdmin.from('dossier_acces').update({ statut: newStatut }).eq('id', access.id);
  if (updError) return res.status(500).json({ error: updError.message });

  return res.status(200).json({ ok: true, statut: newStatut });
}
