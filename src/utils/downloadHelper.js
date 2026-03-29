/**
 * اسم ملف آمن للتحميل — تجنب الأسماء العربية أو الرموز التي تمنع فتح الملف على بعض الأجهزة.
 * يحافظ على امتداد الملف ويستخدم تاريخاً ووقتاً لاتينياً.
 */
function safeDownloadFilename(filename) {
  const base = filename || 'download';
  const extMatch = base.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : '';
  const safe = base.replace(/\.[a-zA-Z0-9]+$/, '');
  const hasNonAscii = /[^\x00-\x7F]/.test(safe);
  if (hasNonAscii || /[\s<>:"/\\|?*]/.test(safe)) {
    const date = new Date();
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
    return `report_${stamp}${ext}`;
  }
  return base;
}

/**
 * تحميل ملف من Blob — يعمل في المتصفح وفي WebView (Capacitor/Android).
 * يستخدم اسم ملف آمن لضمان نجاح التنزيل وفتح الملف.
 */
export function downloadBlob(blob, filename) {
  if (!blob || !(blob instanceof Blob)) return;
  const safeName = safeDownloadFilename(filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.style.display = 'none';
  a.setAttribute('download', safeName);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}
