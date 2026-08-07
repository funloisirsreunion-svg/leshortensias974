import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { assignClsNumber } from '../../lib/clsDossierNumber.js';
import { assignGrpNumber } from '../../lib/grpDossierNumber.js';
import { assignDossierNumber as assignColNumber } from '../../lib/dossierNumber.js';

const PROGRAMMES = new Set(['nature', 'volcan']);
const DUREES = new Set([3, 4, 5]);
const CLIENT_TYPES = new Set(['school', 'group', 'colony']);
const STRUCTURE_TYPES = new Set(['association', 'club_sportif', 'entreprise', 'collectivite', 'famille', 'etablissement', 'organisme_public', 'autre']);
const FORMULES = new Set(['pension_complete', 'demi_pension', 'weekend', 'autre']);

function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }

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
  const clientType = CLIENT_TYPES.has(body.clientType) ? body.clientType : 'school';

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
      adresse: str(body.adresse) || null,
      contact_nom: str(body.contact_nom) || null,
      contact_prenom: str(body.contact_prenom) || null,
      contact_telephone: str(body.contact_telephone) || null,
      contact_email: str(body.contact_email) || null,
      programme: body.programme || null,
      duree: body.duree ? Number(body.duree) : null,
      periode_souhaitee: str(body.periode_souhaitee) || null,
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
    };
  } else {
    // colony
    const enfantNom = str(body.enfant_nom);
    const enfantPrenom = str(body.enfant_prenom);
    if (!enfantNom || !enfantPrenom) return res.status(400).json({ error: 'Le nom et le prénom de l\'enfant sont obligatoires.' });

    payload = {
      client_type: 'colony',
      etablissement: `${enfantPrenom} ${enfantNom}`,
      enfant_nom: enfantNom,
      enfant_prenom: enfantPrenom,
      enfant_date_naissance: body.enfant_date_naissance || null,
      enfant_sexe: body.enfant_sexe || null,
      contact_nom: str(body.contact_nom) || null,
      contact_telephone: str(body.contact_telephone) || null,
      contact_email: str(body.contact_email) || null,
      beneficiaire_vacaf: body.beneficiaire_vacaf === true || body.beneficiaire_vacaf === 'true',
      numero_allocataire: str(body.numero_allocataire) || null,
      colonie_nom: str(body.colonie_nom) || null,
      tarif_colonie: numOrNull(body.tarif_colonie),
    };
  }

  try {
    let numero;
    if (clientType === 'school') numero = await assignClsNumber();
    else if (clientType === 'group') numero = await assignGrpNumber();
    else numero = await assignColNumber(`admin-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    const { data, error } = await supabaseAdmin
      .from('dossiers')
      .insert({ numero, ...payload })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ dossier: data });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Échec de la création du dossier.' });
  }
}
