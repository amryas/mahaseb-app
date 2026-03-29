# Rate Limiting و Observability — الخطوات القادمة

## 1️⃣ RLS في Supabase (تم إعداده)

تم إضافة ملف **`supabase/migrations/001_enable_rls.sql`** الذي يفعل RLS على كل الجداول ويضبط السياسات.

### ⚠️ أهمية WITH CHECK في INSERT و UPDATE

بدون **WITH CHECK** في سياسات INSERT (وUPDATE) يمكن للمستخدم إدخال أو تحديث بيانات **لحساب غيره**. لذلك كل سياسة INSERT و UPDATE في الملف تحتوي على `WITH CHECK` بنفس شرط الملكية.

مثال صحيح لـ account_data:

```sql
CREATE POLICY account_data_insert_own ON account_data
FOR INSERT
WITH CHECK (
  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
);
```

### ماذا يفعل الملف 001

- **devices:** تفعيل RLS + سياسات SELECT/INSERT/UPDATE (الوصول فقط عندما `user_id = auth.uid()`). INSERT حالياً `WITH CHECK (true)` للسماح بإنشاء جهاز قبل تسجيل الدخول.
- **accounts:** تفعيل RLS + SELECT/INSERT/UPDATE/DELETE **مع WITH CHECK في INSERT و UPDATE** بحيث الوصول فقط للحسابات المرتبطة بالمستخدم أو بجهازه:
  - `user_id = auth.uid()` أو
  - `device_id IN (SELECT id FROM devices WHERE user_id = auth.uid())`
- **account_data:** تفعيل RLS + SELECT/INSERT/UPDATE/DELETE **مع WITH CHECK في INSERT و UPDATE** بحيث الوصول فقط لبيانات الحسابات المسموح بها.

### كيف تُطبّق السياسات

1. افتح **Supabase Dashboard** → المشروع.
2. من القائمة: **SQL Editor**.
3. انسخ محتوى `supabase/migrations/001_enable_rls.sql` والصقه في استعلام جديد.
4. نفّذ الاستعلام (Run).

تأكد أن الجداول `devices`, `accounts`, `account_data` موجودة وأن أعمدة `user_id` و `device_id` و `account_id` كما في التطبيق.

### device_id مقابل user_id — متى أستخدم أيهما؟

- **ربط الحساب بـ device_id** مناسب لسيناريوهات:
  - تسجيل دخول بدون حساب (استخدام بالجهاز فقط).
  - حسابات مرتبطة بالجهاز ثم ربطها لاحقاً بمستخدم.
- **لو تحوّل التطبيق إلى SaaS حقيقي** يُنصح بالاعتماد على **user_id** فقط:
  - الجهاز يمكن تغييره (هاتف جديد، متصفح آخر).
  - الحساب يجب أن يتبع المستخدم وليس الجهاز.

ملف **`supabase/migrations/002_rls_saas_only_user_id.sql`** يوفّر سياسات بديلة تربط **accounts** و **account_data** بـ **user_id** فقط (بدون device_id). شغّله بعد 001 إذا أصبح تسجيل الدخول إلزامياً وكل حساب مرتبط بمستخدم واحد.

---

## 2️⃣ Rate Limiting (منع إساءة استخدام الـ API)

عند تحويل التطبيق إلى **SaaS** يُنصح بحدّ استدعاءات الـ API لكل مستخدم/عميل لتجنّب الإساءة والتكلفة العالية.

### خيارات مناسبة

| الأداة | الاستخدام |
|--------|-----------|
| **Supabase Edge Functions** | كتابة دالة على حافة الشبكة تتحقق من الهوية وتعد الطلبات ثم ترد برسالة 429 عند تجاوز الحد. يمكن ربطها بـ Redis أو جدول في Postgres لحفظ العداد. |
| **Cloudflare** | تفعيل Rate Limiting من لوحة Cloudflare (قواعد بعدد الطلبات لكل IP أو مفتاح). مناسب لو التطبيق يمر عبر Cloudflare. |
| **Supabase + Postgres** | جدول يخزّن عدد الطلبات لكل `user_id` أو `api_key` وزراعة تحقق في RLS أو في دالة تُستدعى قبل العمليات الحساسة (أثقل من Edge/Cloudflare لكن ممكن). |

### تطبيق لاحق (مثال فكرة)

- تحديد حدّ مثل: 500 طلب/ساعة للمستخدم الواحد (أو أكثر حسب الباقة).
- في **Edge Function**: قراءة الهوية من JWT، زيادة عداد في Redis/Postgres، إذا تجاوز الحد أرجِع `429 Too Many Requests`.
- أو وضع التطبيق خلف **Cloudflare** واستخدام قواعد Rate Limiting الجاهزة حسب IP أو header (مثلاً مفتاح عميل).

لا يوجد تنفيذ داخل كود التطبيق الحالي؛ يُنفَّذ لاحقاً عند التحول إلى SaaS.

---

## 3️⃣ Observability (المراقبة والسجلات وتتبع الأخطاء)

بعد استقرار الأمان وـ RLS، الخطوة التالية الموصى بها: **مراقبة سلوك التطبيق والأخطاء** (Logs, Error tracking, Monitoring).

### أدوات مقترحة

| الأداة | الغرض |
|--------|--------|
| **Sentry** | تتبع الأخطاء والاستثناءات في الواجهة الأمامية (والباكند إن وُجد). يسجّل الـ stack trace والـ context ويساعد في تشخيص الأعطال بسرعة. |
| **LogRocket** | تسجيل جلسات المستخدم (session replay) مع الـ console والشبكة. مفيد لفهم «ماذا فعل المستخدم قبل حدوث الخطأ؟». |
| **PostHog** | تحليلات واستقصاء سلوك المستخدم (أحداث، مسارات، تحويلات) مع إمكانية self-hosted. مناسب لمراقبة الاستخدام واتخاذ قرارات المنتج. |

### تنفيذ لاحق (مثال)

- **Sentry:** تثبيت `@sentry/react` (أو Vue حسب التطبيق)، استدعاء `Sentry.init()` في نقطة دخول التطبيق، وربط `DSN` من مشروع Sentry. يمكن إضافة معاملات إضافية (مثل بيئة التشغيل، إصدار التطبيق).
- **LogRocket:** إضافة السكربت من لوحة LogRocket في `index.html` أو في نقطة الدخول.
- **PostHog:** تثبيت مكتبة PostHog وتفعيل تتبع الأحداث المهمة (فتح التطبيق، إنشاء حساب، تصدير تقرير، إلخ).

لا يوجد تنفيذ فعلي لهذه الأدوات في المشروع حالياً؛ الوثيقة توضّح الخطوة القادمة بعد الأمان.

---

## ترتيب مقترح للتنفيذ

1. **الآن:** تطبيق RLS في Supabase عبر تشغيل `001_enable_rls.sql` والتحقق من أن الوصول للبيانات يقتصر على المستخدم الحالي فقط.
2. **قبل أو مع إطلاق SaaS:** إضافة Rate Limiting (Edge Functions أو Cloudflare أو كليهما).
3. **بعد الاستقرار:** إضافة Observability (Sentry أولاً للأخطاء، ثم LogRocket أو PostHog حسب الحاجة).
