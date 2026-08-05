const ACCENT_MAP = {
  à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e',
  î: 'i', ï: 'i', ì: 'i', í: 'i', ô: 'o', ö: 'o', ò: 'o', ó: 'o', õ: 'o',
  ù: 'u', û: 'u', ü: 'u', ú: 'u', ñ: 'n', ý: 'y', ÿ: 'y',
};

export function slugify(str) {
  return String(str || '')
    .split('')
    .map((ch) => {
      const low = ch.toLowerCase();
      return ACCENT_MAP[low] || ch;
    })
    .join('')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'X';
}
