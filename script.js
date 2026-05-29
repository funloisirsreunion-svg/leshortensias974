// Navbar scroll
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// Menu mobile
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  navToggle.classList.toggle('open');
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.classList.remove('open');
  });
});

// Animations au scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.service-card, .about-inner, .galerie-item, .contact-card, .stat').forEach((el, i) => {
  el.classList.add('fade-in');
  if (i % 4 === 1) el.classList.add('fade-in-delay-1');
  if (i % 4 === 2) el.classList.add('fade-in-delay-2');
  if (i % 4 === 3) el.classList.add('fade-in-delay-3');
  observer.observe(el);
});

// Formulaire de contact
document.getElementById('contactForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const btn = this.querySelector('button[type=submit]');
  const nom = this.nom.value;
  btn.textContent = 'Message envoyé ✓';
  btn.style.background = '#4a7c59';
  btn.disabled = true;

  const subject = encodeURIComponent('Demande de renseignement – Les Hortensias');
  const body = encodeURIComponent(
    `Nom : ${nom} ${this.prenom.value}\n` +
    `Email : ${this.email.value}\n` +
    `Séjour : ${this.sejour.value}\n\n` +
    `${this.message.value}`
  );
  window.location.href = `mailto:leshortensias97431@gmail.com?subject=${subject}&body=${body}`;
});
