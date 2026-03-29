# إعداد الدفع من التطبيق (فودافون كاش / انستا باي) — Paymob

حتى يدفع العميل من داخل التطبيق ويُفعّل اشتراكه فوراً بدون تدخلك، تحتاج الآتي.

---

## 1) حساب Paymob

1. سجّل في [Paymob](https://paymob.com) واحصل على حساب تاجر.
2. من لوحة Paymob:
   - **Settings → Account Info**: انسخ **API Key**.
   - **Developers → iframes**: انسخ **iframe ID**.
   - **Developers → Payment Integrations**: انسخ **Mobile Wallet ID** (للوالت / فودافون كاش).

---

## 2) نشر Edge Functions في Supabase

الدوال موجودة في المشروع في `supabase/functions/` (مثلاً `create-payment` و `paymob-webhook`). تحتاج تنشرها على مشروعك:

1. ثبّت Supabase CLI إن لم يكن مثبتاً:
   ```bash
   npm install -g supabase
   ```
2. سجّل الدخول وربط المشروع:
   ```bash
   supabase login
   supabase link --project-ref <مُعرّف_المشروع>
   ```
   (مُعرّف المشروع من لوحة Supabase → Settings → General → Reference ID)
3. ضبط الأسرار (مفاتيح Paymob):
   ```bash
   supabase secrets set PAYMOB_API_KEY=الـ_API_Key_اللي_نسختها
   supabase secrets set PAYMOB_IFRAME_ID=رقم_الـ_iframe
   supabase secrets set PAYMOB_WALLET_INTEGRATION_ID=رقم_Mobile_Wallet_ID
   supabase secrets set SUPABASE_ANON_KEY=المفتاح_الـ_anon_من_الإعدادات
   ```
4. نشر الدوال:
   ```bash
   supabase functions deploy create-payment
   supabase functions deploy paymob-webhook
   ```

---

## 3) ويب هوك Paymob (تفعيل الاشتراك فور الدفع)

1. من لوحة Paymob ابحث عن **Callback URL** أو **Webhook URL** أو **Server-to-Server**.
2. ضع الرابط التالي (استبدل `PROJECT_REF` بمُعرّف مشروع Supabase):
   ```
   https://PROJECT_REF.supabase.co/functions/v1/paymob-webhook
   ```
3. عند نجاح الدفع، Paymob يرسل طلباً لهذا الرابط والتطبيق يفعّل الاشتراك تلقائياً.

---

## 4) رابط العودة بعد الدفع (اختياري)

لو Paymob يسمح بتعيين **Return URL** أو **Success URL**، ضع رابط تطبيقك مع `?payment=success`، مثلاً:

- إذا التطبيق على نطاقك:  
  `https://yourdomain.com?payment=success`
- أو على Vercel/Netlify:  
  `https://your-app.vercel.app?payment=success`

بهذا بعد الدفع يرجع العميل للتطبيق وتظهر له رسالة «تم الدفع بنجاح».

---

## 5) التأكد من الجداول

تأكد أنك شغّلت الـ migration للاشتراكات والدفع في Supabase (جدولا `subscriptions` و `payments`) كما في `supabase/migrations/003_subscriptions_payments.sql`.

---

## ملخص التدفق

1. العميل يضغط «ادفع الآن» في صفحة الاشتراك.
2. التطبيق يستدعي الدالة `create-payment` ويحوّل العميل لصفحة الدفع Paymob (فودافون كاش / انستا باي).
3. بعد الدفع الناجح:
   - Paymob يرسل ويب هوك إلى `paymob-webhook` → يتم تحديث `payments` وتفعيل/تجديد الاشتراك في `subscriptions` فوراً.
   - إذا ضبطت Return URL مع `?payment=success` يرجع العميل للتطبيق ويرى أن اشتراكه مفعّل.

لو حابب نربط تفعيل الاشتراك بمنع استخدام التطبيق عند انتهاء الاشتراك، نقدر نضيف التحقق من `subscriptions` عند فتح التطبيق ونظهر رسالة «يجب تجديد الاشتراك» حتى يدفع من نفس الصفحة.
