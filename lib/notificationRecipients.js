// Destinataires centralisés des notifications de demandes de devis (Classes de
// découverte + Groupes indépendants). Les Colonies ont leur propre configuration
// (EMAIL_TO dans api/send-inscription.js) et ne passent JAMAIS par ici.
//
// Surcharge possible via la variable d'environnement QUOTE_NOTIFICATION_EMAILS
// (adresses séparées par des virgules).
const DEFAULT_QUOTE_NOTIFICATION_EMAILS = [
  'contact.funloisirsreunion@gmail.com',
  'leshortensias97431@gmail.com',
];

export function getQuoteNotificationRecipients() {
  const fromEnv = (process.env.QUOTE_NOTIFICATION_EMAILS || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const list = fromEnv.length ? fromEnv : DEFAULT_QUOTE_NOTIFICATION_EMAILS;
  return [...new Set(list)]; // jamais deux fois la même boîte
}

export function getSiteUrl() {
  return (process.env.SITE_URL || 'https://www.leshortensias974.fr').replace(/\/+$/, '');
}
