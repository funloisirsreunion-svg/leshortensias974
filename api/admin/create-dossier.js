import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requirePermission } from '../../lib/requireAdmin.js';
import { assignClsNumber } from '../../lib/clsDossierNumber.js';
import { assignGrpNumber } from '../../lib/grpDossierNumber.js';

const PROGRAMMES = new Set(['nature', 'volcan']);
const DUREES = new Set([3, 4, 5]);
// Les colonies ne passent plus par ce endpoint : un séjour colonie se crée
// directement dans colony_stays (admin/colonie.html), les familles s'inscrivent
// ensuite dans colony_registrations. Ce endpoint ne gère plus que école/groupe,
// pour lesquels un séjour = un dossier `dossiers` (inchangé).
const CLIENT_TYPES = new Set(['school', 'group']);
const STRUCTURE_TYPES = new Set(['association', 'club_sportif', 'entreprise', 'collectivite', 'famille', 'etablissement', 'organisme_public', 'autre']);
const FORMULES = new Set(['pension_complete', 'demi_pension', 'weekend', 'autre']);

function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
function dateOrNull(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const body = req.body || {};
  const clientType = CLIENT_TYPES.has(body.clientType) ? body.clientType : 'school';

  let auth;
  try {
    auth = await requirePermission(req, clientType === 'group' ? 'groups.create' : 'classes.create');
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const supabaseAdmin = getSupabaseAdmin();
  let payload;

  if (clientType === 'school') {
    const etablissement = str(body.etablissement);
    if (!etablissement) return res.status(400).json({ error: 'Le nom de l\'établissement est obligatoire.' });
    if (body.programme && !PROGRAMMES.has(body.programme)) return res.status(400).json({ error: 'Programme invalide (nature ou volcan).' });
    if (body.duree && !DUREES.has(Number(body.duree))) return res.status(400).json({ error: 'Durée invalide (3, 4 ou 5 jours).' });

    payload = {
      client_type: 'school',
      etablissement,
      commune: str(body.commune) || null,
      code_postal: str(body.code_postal) || null,
      adresse: str(body.adresse) || null,
      contact_nom: str(body.contact_nom) || null,
      contact_prenom: str(body.contact_prenom) || null,
      contact_telephone: str(body.contact_telephone) || null,
      contact_email: str(body.contact_email) || null,
      programme: body.programme || null,
      duree: body.duree ? Number(body.duree) : null,
      periode_souhaitee: str(body.periode_souhaitee) || null,
      date_proposee: dateOrNull(body.date_proposee),
      date_confirmee_debut: dateOrNull(body.date_confirmee_debut),
      date_confirmee_fin: dateOrNull(body.date_confirmee_fin),
      effectif_prev_eleves: intOrNull(body.effectif_prev_eleves),
      effectif_prev_profs: intOrNull(body.effectif_prev_profs),
      effectif_prev_accompagnateurs: intOrNull(body.effectif_prev_accompagnateurs),
    };
  } else if (clientType === 'group') {
    const structureNom = str(body.structure_nom);
    if (!structureNom) return res.status(400).json({ error: 'Le nom de la structure est obligatoire.' });
    if (body.structure_type && !STRUCTURE_TYPES.has(body.structure_type)) return res.status(400).json({ error: 'Type de structure invalide.' });
    if (body.formule && !FORMULES.has(body.formule)) return res.status(400).json({ error: 'Formule invalide.' });

    payload = {
      client_type: 'group',
      etablissement: structureNom, // affichage générique partagé avec les autres types
      structure_nom: structureNom,
      structure_type: body.structure_type || null,
      contact_nom: str(body.contact_nom) || null,
      contact_prenom: str(body.contact_prenom) || null,
      contact_fonction: str(body.contact_fonction) || null,
      contact_telephone: str(body.contact_telephone) || null,
      contact_email: str(body.contact_email) || null,
      demande_date_arrivee: body.demande_date_arrivee || null,
      demande_heure_arrivee: str(body.demande_heure_arrivee) || null,
      demande_date_depart: body.demande_date_depart || null,
      demande_heure_depart: str(body.demande_heure_depart) || null,
      nb_adultes: intOrNull(body.nb_adultes),
      nb_enfants: intOrNull(body.nb_enfants),
      formule: body.formule || null,
      estimation_montant: numOrNull(body.estimation_montant),
      date_confirmee_debut: dateOrNull(body.date_confirmee_debut),
      date_confirmee_fin: dateOrNull(body.date_confirmee_fin),
    };
  }

  try {
    const numero = clientType === 'school' ? await assignClsNumber() : await assignGrpNumber();

    const { data, error } = await supabaseAdmin
      .from('dossiers')
      .insert({ numero, ...payload, source: 'admin', created_by: auth.user.id })
      .select()
      .single();

    if (error) throw error;

    // Client existant choisi dans la recherche : le nouveau séjour rejoint ce client
    // (même espace client, aucun compte ni identifiant recréé). Sinon, rattachement
    // à l'organisation retrouvée par nom + e-mail, ou création.
    // Best-effort : la création du dossier ne doit jamais échouer à cause de cette étape.
    const existingOrgId = UUID_RE.test(body.organizationId || '') ? body.organizationId : null;
    let organizationId = null;
    if (existingOrgId) {
      const { data: org } = await supabaseAdmin.from('organizations').select('id').eq('id', existingOrgId).maybeSingle();
      if (org) {
        const { error: attachError } = await supabaseAdmin.from('dossiers').update({ organization_id: org.id }).eq('id', data.id);
        if (!attachError) organizationId = org.id;
      }
    }
    if (!organizationId) {
      const { data: ensured } = await supabaseAdmin.rpc('ensure_dossier_organization', { p_dossier_id: data.id });
      organizationId = ensured || null;
    }
    if (organizationId) data.organization_id = organizationId;

    return res.status(201).json({ dossier: data });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Échec de la création du dossier.' });
  }
}
