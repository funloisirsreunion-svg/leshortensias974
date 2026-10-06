// Page Colonies : séjours affichés dynamiquement depuis Supabase (table
// colony_stays), avec exactement les mêmes critères que le formulaire
// d'inscription (inscription.js) : ouvert aux inscriptions publiques, non
// annulé, non archivé. Un séjour fermé dans l'Admin disparaît donc à la fois
// de cette page et du formulaire, sans modification de code.
(function () {
  'use strict';

  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function parts(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; }
  // « Du 3 au 14 janvier 2027 » / « Du 30 avril au 4 mai 2027 »
  function plage(debut, fin) {
    if (!debut || !fin) return debut ? `À partir du ${parts(debut).d} ${MOIS[parts(debut).m - 1]} ${parts(debut).y}` : 'Dates à venir';
    const a = parts(debut), b = parts(fin);
    if (a.y !== b.y) return `Du ${a.d} ${MOIS[a.m - 1]} ${a.y} au ${b.d} ${MOIS[b.m - 1]} ${b.y}`;
    if (a.m === b.m) return `Du ${a.d} au ${b.d} ${MOIS[b.m - 1]} ${b.y}`;
    return `Du ${a.d} ${MOIS[a.m - 1]} au ${b.d} ${MOIS[b.m - 1]} ${b.y}`;
  }
  function plageCourte(debut, fin) {
    if (!debut || !fin) return 'dates à venir';
    const a = parts(debut), b = parts(fin);
    return a.m === b.m && a.y === b.y ? `${a.d} au ${b.d} ${MOIS[b.m - 1]} ${b.y}` : `${a.d} ${MOIS[a.m - 1]} au ${b.d} ${MOIS[b.m - 1]} ${b.y}`;
  }
  function nbJours(debut, fin) {
    if (!debut || !fin) return null;
    return Math.round((Date.UTC(parts(fin).y, parts(fin).m - 1, parts(fin).d) - Date.UTC(parts(debut).y, parts(debut).m - 1, parts(debut).d)) / 86400000) + 1;
  }
  function tarif(n) {
    if (n === null || n === undefined) return null;
    return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
  }

  async function fetchStays() {
    // Client partagé du site (même configuration publique que l'Espace Client).
    const { getSupabaseClient } = await import('/lib/supabaseClient.js');
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('colony_stays')
      .select('id,nom,date_debut,date_fin,duree_texte,tarif_public,age_min,age_max,public_accueilli,description')
      .eq('public_registration_open', true)
      .neq('statut', 'annule')
      .is('archived_at', null)
      .order('date_debut', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  function card(s) {
    const jours = nbJours(s.date_debut, s.date_fin);
    const age = s.age_min != null && s.age_max != null ? `${s.age_min} – ${s.age_max} ans` : (s.public_accueilli || null);
    const prix = tarif(s.tarif_public);
    return `
      <article class="price-box sejour-card">
        <span class="sejour-nom">${esc(s.nom)}</span>
        <span class="sejour-dates">${esc(plage(s.date_debut, s.date_fin))}</span>
        ${s.duree_texte || jours ? `<span class="price-unit" style="margin:4px 0 14px;">${esc(s.duree_texte || jours + ' jours')}${age ? ' · ' + esc(age) : ''}</span>` : ''}
        ${prix ? `<span class="price-amount">${esc(prix)}</span><span class="price-unit">par enfant · tarif public</span>` : ''}
        <p class="sejour-programme">${s.description ? esc(s.description) : 'Programme et informations à venir'}</p>
        <a href="inscription.html?sejour=${encodeURIComponent(s.id)}" class="btn btn-primary" style="margin-top:18px;">Inscrire mon enfant à ce séjour</a>
      </article>`;
  }

  async function render() {
    const list = document.getElementById('sejoursList');
    const banner = document.getElementById('sejoursBanner');
    const dates = document.getElementById('sejoursDates');
    const cta = document.getElementById('sejoursCta');
    let stays;
    try {
      stays = await fetchStays();
    } catch (e) {
      list.innerHTML = `<p class="sejours-empty">Impossible d'afficher les séjours pour le moment. <a href="inscription.html">Accéder au formulaire d'inscription</a> ou contactez-nous au 06 92 36 58 38.</p>`;
      return;
    }
    if (!stays.length) {
      list.innerHTML = `<p class="sejours-empty">Aucun séjour n'est ouvert aux inscriptions pour le moment. Contactez-nous pour connaître les prochaines dates.</p>`;
      if (banner) banner.style.display = 'none';
      return;
    }
    list.innerHTML = stays.map(card).join('');
    const resume = stays.map(s => plageCourte(s.date_debut, s.date_fin)).join(' · ');
    if (banner) {
      banner.innerHTML = `<span class="alert-banner-icon">🏕️</span><div><strong>Inscriptions ouvertes — ${stays.length > 1 ? stays.length + ' séjours disponibles' : '1 séjour disponible'}</strong>${esc(resume)}</div>`;
      banner.style.display = '';
    }
    if (dates) dates.innerHTML = stays.map(s => esc(plage(s.date_debut, s.date_fin))).join('<br/>');
    if (cta) cta.textContent = `Séjours disponibles : ${resume}`;
  }

  render();
})();
