# خطة التطوير: من localStorage إلى SaaS

## المرحلة 1 — الداتابيز (مكتملة)

- **الهدف:** نقل البيانات من localStorage إلى Supabase.
- **ما تم:**
  - إضافة Supabase client (`src/supabase/config.js`) ومتغيرات `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY`.
  - إنشاء الجداول في Supabase: `devices`, `accounts`, `account_data` (شغّل `supabase/migrations/001_initial_schema.sql` من SQL Editor).
  - طبقة مزامنة `src/data/supabaseSync.js`: تحميل/حفظ الحسابات وبيانات الحساب حسب `device_id`.
  - التطبيق يقرأ ويكتب من/إلى Supabase عند تفعيل المتغيرات؛ localStorage يبقى كـ cache.
- **الاستخدام:** انسخ `.env.example` إلى `.env` واملأ قيم Supabase، ثم شغّل الـ migration في Supabase.

---

## المرحلة 2 — Auth حقيقي (مكتملة)

- **الهدف:** استبدال Firebase Auth (أو عدم وجود تسجيل دخول) بـ **Supabase Auth** (بريد + كلمة مرور).
- **ما تم في الكود:**
  - دعم Supabase Auth في `AuthContext`: تسجيل دخول / إنشاء حساب / خروج عبر `supabase.auth`.
  - عند تفعيل Supabase يظهر طلب تسجيل الدخول؛ بعد الدخول تُربط حسابات الجهاز بالمستخدم وتُحمّل حسابات المستخدم فقط.
  - حفظ الحسابات الجديدة مع `user_id` تلقائياً.
- **خطوة أنت تعملها (مرة واحدة):**
  1. من لوحة Supabase: **Authentication** → **Providers** → **Email**.
  2. تأكد أن **Email** مفعّل (عادة مفعّل افتراضياً).
  3. (اختياري) لو حابب المستخدم يدخل مباشرة بدون تأكيد بريد: أوقف **Confirm email**. لو تركته مفعّلاً، المستخدم يفتح الرابط من بريده ثم يسجّل الدخول.

---

## المرحلة 3 — Multi-tenancy (مكتملة)

- **الهدف:** كل مستخدم يرى بياناته فقط (أساس أي SaaS).
- **ما تم:**
  - migration `002_rls_multi_tenant.sql`: إضافة `user_id` لجدول `devices`، إزالة السياسات المفتوحة، وإضافة سياسات RLS بحيث كل مستخدم يقرأ/يكتب فقط بياناته (`user_id = auth.uid()` للحسابات، وربط `account_data` و `devices` بالمستخدم).
  - تحديث `getOrCreateDeviceId` ليربط الجهاز بالمستخدم عند الإنشاء (`user_id`).
- **خطوة أنت تعملها (مرة واحدة):** من لوحة Supabase → **SQL Editor** → New query → الصق محتوى `supabase/migrations/002_rls_multi_tenant.sql` → Run.

---

## المرحلة 4 — الدفع (فودافون كاش / انستا باي)

- **الهدف:** الدفع عبر **فودافون كاش** و **انستا باي** فقط.
- **ما تم:**
  - صفحة الاشتراكات تعرض بوضوح أن طرق الدفع المتاحة هي فودافون كاش وانستا باي فقط، مع أزرار «اشترك (فودافون كاش / انستا باي)» وفتح واتساب لإتمام الدفع.
  - migration `003_subscriptions_payments.sql`: جدولا `subscriptions` و `payments` في Supabase (مع حقل `method` بقيمتي `vodafone_cash` و `instapay`)، مع RLS.
- **خطوة أنت تعملها:** تشغيل الـ migration من Supabase → SQL Editor (نسخ وتشغيل محتوى `supabase/migrations/003_subscriptions_payments.sql`).
- **لاحقاً (اختياري):** لربط دفع آلي (رابط دفع أو iframe) يمكن استخدام بوابة تدعم فودافون كاش وانستا باي (مثل Paymob) وإضافة API keys ثم استدعاء إنشاء الطلب وويب هوك لتحديث حالة الاشتراك في جدول `subscriptions` و `payments`.
