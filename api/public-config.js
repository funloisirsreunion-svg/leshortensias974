// Expose au navigateur les seules valeurs publiques nécessaires pour initialiser
// le client Supabase (URL + clé anonyme). Ces deux valeurs sont conçues pour être
// publiques : c'est Row Level Security côté Supabase qui protège les données,
// jamais le secret de cette clé.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    gaMeasurementId: process.env.GA_MEASUREMENT_ID || null,
  });
}
