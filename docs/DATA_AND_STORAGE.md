# التخزين وقواعد البيانات في التطبيق

## المعمارية الحالية: Supabase كقاعدة أساسية

عند تفعيل Supabase (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) يصبح التدفق:

```
App (React)
    ↓
Store (قراءة/كتابة من وإلى الـ cache)
    ↓
Supabase API (src/data/supabaseApi.js)  ← طبقة API واحدة للوصول إلى Supabase
    ↓
Supabase (REST / Realtime)
    ↓
PostgreSQL
```

- **المصدر الأساسي للبيانات (Source of Truth):** Supabase → PostgreSQL.
- **localStorage:** يُستخدم كـ **cache فقط**:
  - يُملأ من PostgreSQL عند فتح التطبيق أو تبديل الحساب.
  - عند أي حفظ: تُحدَّث الـ cache فوراً ثم تُرسل التغييرات إلى Supabase (مع debounce).

لا يوجد سيرفر backend خاص بك؛ الـ "API" هنا هي طبقة **supabaseApi.js** التي تتحدث مع Supabase من داخل التطبيق.

---

## 1. طبقة API (supabaseApi.js)

جميع القراءات والكتابات من/إلى Supabase تتم **فقط** عبر هذا الملف:

| الدالة | الوظيفة |
|--------|----------|
| `apiCreateDevice(userId?)` | إنشاء جهاز في جدول `devices`. |
| `apiGetAccountsByDevice(deviceId)` | جلب الحسابات المرتبطة بجهاز من `accounts`. |
| `apiGetAccountsByUser(userId)` | جلب الحسابات المرتبطة بمستخدم من `accounts`. |
| `apiUpsertAccount(id, deviceId, name, userId?)` | إدراج/تحديث حساب في `accounts`. |
| `apiUpdateAccountsUser(deviceId, userId)` | ربط حسابات جهاز بمستخدم (تحديث `user_id`). |
| `apiGetAccountData(accountId)` | جلب **كل** مفاتيح الحساب من `account_data` (المصدر الأساسي). |
| `apiSetAccountKey(accountId, key, value)` | حفظ مفتاح واحد في `account_data` (الكتابة إلى PostgreSQL). |
| `apiWriteCacheToSupabase(accountId, getCacheItem)` | كتابة كل الـ cache لحساب معين إلى `account_data`. |
| `hydrateCacheFromApi(accountId, data)` | ملء الـ cache (localStorage) من نتيجة `apiGetAccountData`. |

دوال الـ cache: `cacheGet`, `cacheSet`, `cacheKey` — للتعامل مع localStorage كـ cache فقط.

---

## 2. الـ cache (localStorage)

يُستخدم **كـ cache فقط** عند تفعيل Supabase.

### مفاتيح عامة

| المفتاح | الوصف |
|---------|--------|
| `mahaseb_accounts` | قائمة الحسابات (تُجلب من `accounts` في Supabase وُتحفظ هنا). |
| `mahaseb_current_account` | معرّف الحساب الحالي. |
| `mahaseb_device_id` | معرّف الجهاز (لربط الحسابات بالجهاز/المستخدم). |

### مفاتيح لكل حساب (cache للبيانات)

الصيغة: **`mahaseb_{accountId}_{suffix}`**

مثال: `mahaseb_abc-123_transactions`

نفس الـ suffix المستخدمة في `account_data` (مثل: transactions, invoices, settings, products, sales, …).  
القراءة تتم من الـ cache (للسرعة)، والكتابة تُحدّث الـ cache ثم تُرسل إلى Supabase عبر `apiSetAccountKey`.

---

## 3. Supabase (PostgreSQL) — المصدر الأساسي عند التفعيل

### الجداول

| الجدول | الوصف |
|--------|--------|
| **devices** | جهاز واحد لكل متصفح/تطبيق: `id` (UUID), `user_id` (اختياري). |
| **accounts** | الحسابات: `id`, `device_id`, `name`, `created_at`, `user_id` (اختياري). |
| **account_data** | بيانات كل حساب مفتاحاً مفتاحاً: `account_id`, `key` (مثل transactions, sales), `value` (JSONB), `updated_at`. المفتاح المركّب: `(account_id, key)`. |

### تدفق البيانات

1. **عند التحميل:** جلب الحسابات من `accounts` ثم جلب `account_data` للحساب الحالي → ملء الـ cache (localStorage).
2. **عند الحفظ:** تحديث الـ cache ثم استدعاء `apiSetAccountKey` (عبر callback المزامنة مع debounce) → الكتابة إلى `account_data`.

---

## 4. Firebase (Firestore) — اختياري

عند استخدام Firebase **بجانب** Supabase: يبقى Firestore للمزامنة الإضافية (مثلاً لمستخدمين قديمين). المصدر الأساسي عند تفعيل Supabase يبقى **Supabase/PostgreSQL**؛ الـ cache يُملأ من Supabase.

---

## 5. Session Storage

لا يُستخدم حالياً في التطبيق.

---

## 6. رأي في الاقتراح (Supabase Primary + localStorage كـ cache)

- **الإيجابيات:**
  - **مصدر واحد للحقيقة:** PostgreSQL يضمن اتساق البيانات بين الأجهزة والمستخدمين.
  - **نسخ احتياطي ومتانة:** البيانات لا تعتمد على جهاز واحد.
  - **قابلية التوسع:** PostgreSQL يدعم عدد كبير من المستخدمين مع فهرسة وـ RLS.
  - **الـ cache يحسّن التجربة:** واجهة سريعة عند القراءة، وتقليل عدد الطلبات إذا أضفنا منطق انتهاء صلاحية أو تحديث انتقائي لاحقاً.

- **ما تم تنفيذه:**
  - طبقة **API واحدة** (`supabaseApi.js`) بين التطبيق وـ Supabase.
  - التطبيق يقرأ من الـ cache ويكتب إلى الـ cache ثم يرسل التحديثات إلى Supabase (مع debounce).
  - عند التحميل وتبديل الحساب: الجلب من Supabase ثم ملء الـ cache.

- **اختياري للمستقبل:**
  - إذا أردت **سيرفر API خاص بك** (Node/Express وغيرها) بين التطبيق وـ Supabase: يمكن جعل التطبيق يستدعي هذا السيرفر بدلاً من استدعاء Supabase مباشرة؛ السيرفر يتحدث مع Supabase بـ service role أو بجداول إضافية. المعمارية الحالية (App → supabaseApi → Supabase → PostgreSQL) كافية لمعظم الحالات وتقلل التعقيد.

---

## 7. تصدير التقارير — أين تظهر الملفات؟

التقارير المُصدَّرة (Excel، PDF) **لا تُخزَّن داخل التطبيق**. عند الضغط على أي زر تصدير (تقرير المبيعات، المصروفات، Excel شامل، إلخ):

- المتصفح يحمّل الملف تلقائياً إلى **مجلد التنزيلات (Downloads)** في الجهاز.
- **الوصول للملفات:** من المستكشف (ويندوز) أو تطبيق الملفات (موبايل) → مجلد **التنزيلات / Downloads**.
- مسار شائع على ويندوز: `C:\Users\<اسم_المستخدم>\Downloads`.

التطبيق يعرض بعد كل تصدير رسالة: «تم التحميل. الملف في مجلد التنزيلات (Downloads) في جهازك.» وتوضيحاً ثابتاً تحت أزرار التصدير في صفحة التقارير.

---

## 8. ملخص

| العنصر | الدور |
|--------|--------|
| **PostgreSQL (Supabase)** | المصدر الأساسي للبيانات عند تفعيل Supabase. |
| **localStorage** | cache للقراءة السريعة وتحديث فوري عند الكتابة؛ يُحدَّث من Supabase عند التحميل. |
| **supabaseApi.js** | طبقة API وحيدة للوصول إلى Supabase (لا استدعاء مباشر من باقي التطبيق). |
| **Store (store.js)** | يقرأ ويكتب من/إلى الـ cache ويشغّل callback المزامنة إلى Supabase. |
