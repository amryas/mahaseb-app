/**
 * تحميل خط عربي (Amiri) لتسجيله في jsPDF حتى يظهر النص العربي بشكل صحيح في PDF.
 * يجرب أولاً /fonts/Amiri-Regular.ttf (نفس المصدر) ثم CDN.
 */
const FONT_VFS_NAME = 'Amiri-Regular.ttf';
const FONT_FACE_NAME = 'Amiri';
const FONT_URLS = [
  '/fonts/Amiri-Regular.ttf',
  'https://mirrors.ctan.org/fonts/amiri/ttf/Amiri-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/alif-type/amiri@v1.000/Amiri-Regular.ttf',
];

let fontBase64Promise = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fetchFontBase64() {
  if (fontBase64Promise == null) {
    fontBase64Promise = (async () => {
      for (const url of FONT_URLS) {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) continue;
          const buffer = await res.arrayBuffer();
          return arrayBufferToBase64(buffer);
        } catch (_) {
          continue;
        }
      }
      throw new Error('تعذر تحميل خط عربي. ضع ملف Amiri-Regular.ttf في مجلد public/fonts أو تحقق من الاتصال.');
    })();
  }
  return fontBase64Promise;
}

/**
 * تحميل الخط العربي وتسجيله في مستند jsPDF. يستخدم خط Amiri لدعم العربية.
 * @param {import('jspdf').jsPDF} doc - نسخة jsPDF
 * @returns {Promise<void>}
 */
export async function loadArabicFont(doc) {
  const base64 = await fetchFontBase64();
  doc.addFileToVFS(FONT_VFS_NAME, base64);
  doc.addFont(FONT_VFS_NAME, FONT_FACE_NAME, 'normal');
}

export function setPdfArabicFont(doc) {
  doc.setFont(FONT_FACE_NAME, 'normal');
}
