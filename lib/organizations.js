// Détection/attribution de l'organisation (client) à laquelle rattacher un
// dossier — utilisé par toute création de dossier école/groupe (admin ou
// publique), pour garantir §2/§16 de la demande multi-dossiers : un même
// établissement (identifié avec certitude par son e-mail de contact) ne doit
// jamais se retrouver avec deux organisations distinctes, quel que soit le
// point d'entrée (formulaire public ou création admin).

function normalizeEmail(email) {
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

// Échappe les caractères spéciaux LIKE/ILIKE (% et _) : l'e-mail de contact
// vient de formulaires publics non authentifiés (demande-devis.js,
// demande-groupe.js) et est réutilisé tel quel comme motif ilike ci-dessous —
// sans cet échappement, un e-mail du type "%@gmail.com" rattacherait la
// demande à l'organisation de n'importe quel autre client dont le contact se
// termine par "@gmail.com".
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Retourne l'organisation à laquelle rattacher un nouveau dossier.
 * - Si `organizationId` est fourni (l'admin a explicitement choisi un client
 *   existant via l'UI de rattachement), on la réutilise telle quelle.
 * - Sinon, on cherche une organisation déjà associée à un dossier partageant
 *   le même e-mail de contact (normalisé) — seule correspondance jugée
 *   certaine sans intervention humaine (§20 : ne jamais fusionner à l'aveugle).
 * - À défaut, on crée une nouvelle organisation.
 */
export async function findOrCreateOrganization(supabaseAdmin, { email, nom, organizationId } = {}) {
  if (organizationId) {
    const { data, error } = await supabaseAdmin
      .from('organizations').select('id').eq('id', organizationId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Organisation cible introuvable.');
    return { organizationId: data.id, isNewOrganization: false, matchedExisting: true };
  }

  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail) {
    const { data: existingDossier, error: findError } = await supabaseAdmin
      .from('dossiers')
      .select('organization_id')
      .not('organization_id', 'is', null)
      .ilike('contact_email', escapeLikePattern(normalizedEmail))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findError) throw findError;
    if (existingDossier?.organization_id) {
      return { organizationId: existingDossier.organization_id, isNewOrganization: false, matchedExisting: true };
    }
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('organizations')
    .insert({ nom: (nom && nom.trim()) || normalizedEmail || 'Client sans nom', contact_email: normalizedEmail })
    .select('id')
    .single();
  if (createError) throw createError;
  return { organizationId: created.id, isNewOrganization: true, matchedExisting: false };
}
