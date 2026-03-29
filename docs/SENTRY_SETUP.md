# إعداد Sentry لمراقبة الأخطاء

لتفعيل تتبع الأخطاء في التطبيق (في الإنتاج):

1. أنشئ مشروعاً في [sentry.io](https://sentry.io) واختر **React**.
2. انسخ **DSN** من إعدادات المشروع.
3. أضف متغير البيئة في ملف `.env` أو في منصة الاستضافة:

   ```
   VITE_SENTRY_DSN=https://xxxx@xxxx.ingest.sentry.io/xxxx
   ```

4. أعد بناء التطبيق: `npm run build`.

عند حدوث خطأ (مثلاً من ErrorBoundary)، سيُرسل تلقائياً إلى Sentry مع تفاصيل الجلسة. يمكنك تعطيل Replay أو تقليل `replaysSessionSampleRate` من `src/main.jsx` إن أردت توفير الحصة.
