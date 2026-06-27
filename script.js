// Navbar scroll
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// Menu mobile
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  navToggle.classList.toggle('open');
});

// Dropdown "Nos séjours"
document.querySelectorAll('.has-dropdown').forEach(item => {
  const trigger = item.querySelector('.dropdown-trigger');
  trigger.addEventListener('click', e => {
    e.preventDefault();
    item.classList.toggle('open');
  });
});

document.addEventListener('click', e => {
  if (!e.target.closest('.has-dropdown')) {
    document.querySelectorAll('.has-dropdown').forEach(d => d.classList.remove('open'));
  }
});

// Fermer le menu mobile sur clic de lien (sauf dropdown trigger)
navLinks.querySelectorAll('a:not(.dropdown-trigger)').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.classList.remove('open');
  });
});

// Marquer le lien actif
const currentPage = location.pathname.split('/').pop() || 'index.html';
navLinks.querySelectorAll('a').forEach(a => {
  if (a.getAttribute('href') === currentPage) a.classList.add('active');
});

// Animations au scroll
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });

document.querySelectorAll('.service-card, .about-inner, .galerie-item, .contact-card, .stat, .activity-card, .highlight-card, .info-row').forEach((el, i) => {
  el.classList.add('fade-in');
  if (i % 4 === 1) el.classList.add('fade-in-delay-1');
  if (i % 4 === 2) el.classList.add('fade-in-delay-2');
  if (i % 4 === 3) el.classList.add('fade-in-delay-3');
  observer.observe(el);
});

// Observer aussi les éléments avec fade-in défini directement en HTML (ex: inscription.html)
document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// Tabs programme (page classes)
document.querySelectorAll('.sub-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panel = tab.closest('.program-panel');
    panel.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    panel.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.target);
    if (target) target.classList.add('active');
  });
});

document.querySelectorAll('.program-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.program-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.program-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.target);
    if (target) target.classList.add('active');
  });
});

// Bloc conditionnel Classe Découverte (page contact)
const sejourSelect = document.getElementById('sejour');
const classeBlock  = document.getElementById('classeDecouverteBlock');
if (sejourSelect && classeBlock) {
  sejourSelect.addEventListener('change', () => {
    classeBlock.style.display = sejourSelect.value === 'classe-decouverte' ? 'block' : 'none';
  });
}

// Bouton retour en haut
const backToTop = document.getElementById('backToTop');
if (backToTop) {
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
}

// Formulaire de contact — désactiver le bouton pendant l'envoi (POST vers FormSubmit)
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', function() {
    const btn = this.querySelector('button[type=submit]');
    btn.textContent = 'Envoi en cours…';
    btn.disabled = true;
  });
}
