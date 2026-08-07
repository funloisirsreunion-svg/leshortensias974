import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { assignGrpNumber } from '../../lib/grpDossierNumber.js';
import { buildDemandeGroupeSubject, buildDemandeGroupeHtml } from '../../lib/demandeGroupeEmail.js';

// Endpoint public (aucune authentification) : demande de devis Groupe Indépendant.
// Toujours enregistrer la demande AVANT de tenter l'e-mail.

const STRUCTURE_TYPES = new Set(['association', 'club_sportif', 'entreprise', 'collectivite', 'famille', 'etablissement', 'organisme_public', 'autre']);
const FORMULES = new Set(['pension_complete', 'demi_pension', 'weekend', 'autre']);

function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const body = req.body || {};
  if (str(body.honeypot)) {
    return res.status(200).json({ ok: true });
  }

  const structureNom = str(body.structureNom);
  const structureType = STRUCTURE_TYPES.has(body.structureType) ? body.structureType : null;
  const contactNom = str(body.contactNom);
  const contactPrenom = str(body.contactPrenom);
  const contactFonction = str(body.contactFonction);
  const contactTelephone = str(body.contactTelephone);
  const contactEmail = str(body.contactEmail);
  const dateArrivee = str(body.dateArrivee);
  const heureArrivee = str(body.heureArrivee);
  const dateDepart = str(body.dateDepart);
  const heureDepart = str(body.heureDepart);
  const nbAdultes = intOrNull(body.nbAdultes);
  const nbEnfants = intOrNull(body.nbEnfants);
  const formule = FORMULES.has(body.formule) ? body.formule : null;
  const premierRepas = str(body.premierRepas);
  const dernierRepas = str(body.dernierRepas);
  const repasSupp = intOrNull(body.repasSupp);
  const gouterSouhaite = body.gouterSouhaite === true;
  const gouterJours = intOrNull(body.gouterJours);
  const regimesAlim = str(body.regimesAlim);
  const salleReunion = body.salleReunion === true;
  const besoinsAutres = str(body.besoinsAutres);
  const estimationTarifaire = str(body.estimationTarifaire);

  if (!structureNom) return res.status(400).json({ error: 'Le nom de la structure est obligatoire.' });
  if (!contactNom || !contactPrenom || !contactTelephone) return res.status(400).json({ error: 'Les coordonnées du responsable sont obligatoires.' });
  if (!isValidEmail(contactEmail)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (!dateArrivee || !dateDepart) return res.status(400).json({ error: 'Les dates d\'arrivée et de départ sont obligatoires.' });
  if (!nbAdultes || nbAdultes < 1) return res.status(400).json({ error: 'Le nombre d\'adultes est obligatoire.' });
  if (!formule) return res.status(400).json({ error: 'Merci de choisir une formule.' });

  const supabaseAdmin = getSupabaseAdmin();
  let dossier;
  try {
    const numero = await assignGrpNumber();
    const { data, error } = await supabaseAdmin
      .from('dossiers')
      .insert({
        numero,
        source: 'public',
        client_type: 'group',
        etablissement: structureNom,
        structure_nom: structureNom,
        structure_type: structureType,
        contact_nom: contactNom,
        contact_prenom: contactPrenom,
        contact_fonction: contactFonction || null,
        contact_telephone: contactTelephone,
        contact_email: contactEmail,
        demande_date_arrivee: dateArrivee,
        demande_heure_arrivee: heureArrivee || null,
        demande_date_depart: dateDepart,
        demande_heure_depart: heureDepart || null,
        nb_adultes: nbAdultes,
        nb_enfants: nbEnfants,
        formule,
        premier_repas: premierRepas || null,
        dernier_repas: dernierRepas || null,
        repas_supplementaires_nombre: repasSupp,
        gouter_souhaite: gouterSouhaite,
        gouter_jours: gouterJours,
        remarques_alimentaires: regimesAlim || null,
        salle_reunion: salleReunion,
        besoins_particuliers: besoinsAutres || null,
        estimation_tarifaire: estimationTarifaire || null,
      })
      .select()
      .single();
    if (error) throw error;
    dossier = data;
  } catch (error) {
    return res.status(500).json({ error: 'Échec de l\'enregistrement de la demande. Merci de réessayer ou de nous contacter directement.' });
  }

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
        subject: buildDemandeGroupeSubject(structureNom),
        html: buildDemandeGroupeHtml({ dossier, adminUrl }),
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
