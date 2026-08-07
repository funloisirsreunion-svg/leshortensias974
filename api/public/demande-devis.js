import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { assignClsNumber } from '../../lib/clsDossierNumber.js';
import { buildDemandeDevisSubject, buildDemandeDevisHtml } from '../../lib/demandeDevisEmail.js';

// Endpoint public (aucune authentification) : reçoit une demande de devis Classe
// Découverte depuis inscription-classe.html. Toujours enregistrer la demande AVANT
// de tenter l'e-mail : un échec d'e-mail ne doit jamais faire perdre la demande.

const NIVEAU_LABEL_TO_KEY = {
  Maternelle: 'maternelle', CP: 'cp', CE1: 'ce1', CE2: 'ce2', CM1: 'cm1', CM2: 'cm2', Autre: 'autre',
};
const PROGRAMME_LABEL_TO_VALUE = { 'Classe Volcan': 'volcan', 'Classe Nature': 'nature' };

function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const body = req.body || {};

  // Piège à robots (champ caché, identique à l'ancien formulaire FormSubmit).
  if (str(body.honeypot)) {
    return res.status(200).json({ ok: true }); // réponse neutre, ne révèle rien au bot
  }

  const etablissement = str(body.etablissement);
  const commune = str(body.commune);
  const contactNom = str(body.contactNom);
  const contactPrenom = str(body.contactPrenom);
  const contactFonction = str(body.contactFonction);
  const contactTelephone = str(body.contactTelephone);
  const contactEmail = str(body.contactEmail);
  const programme = PROGRAMME_LABEL_TO_VALUE[str(body.programme)] || null;
  const duree = intOrNull(str(body.duree).replace(/\D/g, ''));
  const periodeSouhaitee = str(body.periode);
  const niveauxLabels = Array.isArray(body.niveaux) ? body.niveaux.map(str).filter(Boolean) : [];
  const nbClasses = intOrNull(body.nbClasses);
  const nbEleves = intOrNull(body.nbEleves);
  const nbProfs = intOrNull(body.nbProfs);
  const nbAccomp = intOrNull(body.nbAccomp);
  const estimationTarifaire = str(body.estimationTarifaire);

  if (!etablissement || !commune) {
    return res.status(400).json({ error: 'Le nom de l\'école et la commune sont obligatoires.' });
  }
  if (!contactNom || !contactPrenom || !contactTelephone) {
    return res.status(400).json({ error: 'Les coordonnées du référent sont obligatoires.' });
  }
  if (!isValidEmail(contactEmail)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  }
  if (!programme) {
    return res.status(400).json({ error: 'Merci de choisir un programme (Classe Volcan ou Classe Nature).' });
  }
  if (!nbEleves || nbEleves < 1) {
    return res.status(400).json({ error: 'Le nombre d\'élèves est obligatoire.' });
  }

  const niveaux = {};
  niveauxLabels.forEach((label) => {
    const key = NIVEAU_LABEL_TO_KEY[label];
    if (key) niveaux[key] = 1; // présence du niveau ; effectif précis complété plus tard par l'enseignant
  });

  const supabaseAdmin = getSupabaseAdmin();
  let dossier;
  try {
    const numero = await assignClsNumber();
    const { data, error } = await supabaseAdmin
      .from('dossiers')
      .insert({
        numero,
        source: 'public',
        etablissement,
        commune,
        contact_nom: contactNom,
        contact_prenom: contactPrenom,
        contact_fonction: contactFonction || null,
        contact_telephone: contactTelephone,
        contact_email: contactEmail,
        programme,
        duree,
        periode_souhaitee: periodeSouhaitee || null,
        niveaux,
        effectif_prev_eleves: nbEleves,
        effectif_prev_profs: nbProfs,
        effectif_prev_accompagnateurs: nbAccomp,
        estimation_tarifaire: estimationTarifaire || null,
      })
      .select()
      .single();
    if (error) throw error;
    dossier = data;
  } catch (error) {
    return res.status(500).json({ error: 'Échec de l\'enregistrement de la demande. Merci de réessayer ou de nous contacter directement.' });
  }

  // Journal détaillé (le trigger a déjà posé une entrée générique 'demande_creee').
  try {
    const recap = [
      nbClasses ? `${nbClasses} classe(s)` : null,
      `${nbEleves} élève(s)`,
      nbProfs ? `${nbProfs} professeur(s)` : null,
      nbAccomp ? `${nbAccomp} accompagnateur(s)` : null,
    ].filter(Boolean).join(', ');
    await supabaseAdmin.from('dossier_journal').insert({
      dossier_id: dossier.id,
      action: 'demande_detail',
      details: recap,
    });
  } catch { /* non bloquant */ }

  // Notification e-mail à Fun Loisirs Réunion — un échec ici ne doit jamais faire
  // perdre la demande, déjà enregistrée en base à ce stade.
  let emailSent = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.EMAIL_FROM
        || (process.env.RESEND_EMAIL_DOMAIN ? `Les Hortensias <demandes@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Les Hortensias <onboarding@resend.dev>');
      const adminUrl = (process.env.SITE_URL || 'https://leshortensias974.fr') + `/admin/dossier.html?id=${dossier.id}`;
      const { error: sendError } = await resend.emails.send({
        from,
        to: process.env.EMAIL_TO || 'contact.funloisirsreunion@gmail.com',
        subject: buildDemandeDevisSubject(etablissement),
        html: buildDemandeDevisHtml({ dossier, adminUrl }),
      });
      if (sendError) throw new Error(sendError.message || JSON.stringify(sendError));
      emailSent = true;
    } catch (error) {
      try {
        await supabaseAdmin.from('dossier_journal').insert({
          dossier_id: dossier.id,
          action: 'notification_echec',
          details: 'Échec de l\'envoi de la notification e-mail : ' + (error.message || ''),
        });
      } catch { /* non bloquant */ }
    }
  }

  return res.status(201).json({ ok: true, numero: dossier.numero, emailSent });
}
