# طابور المزامنة (Sync Queue)

> تم تنفيذ الطابور محلياً: عند فشل الحفظ نضيف للطابور (localStorage) ونحدّث الـ cache تفاؤلياً؛ عند التحميل وعودة الاتصال نعالج الطابور. يُمسح الطابور عند تسجيل الخروج.

## الغرض

طبقة **Offline First**: عند انقطاع الشبكة تُسجّل العمليات في طابور محلي ثم تُرسل إلى السحابة عند عودة الاتصال.

## الجدول في Supabase (`sync_queue`)

تم إنشاؤه في `supabase/migrations/004_workspace_saas.sql`:

| العمود | النوع | الوصف |
|--------|--------|--------|
| `id` | uuid | مفتاح أساسي |
| `workspace_id` | uuid | مساحة العمل |
| `user_id` | uuid | المستخدم (اختياري) |
| `table_name` | text | الجدول المستهدف: `products`, `transactions`, `invoices` |
| `record_id` | uuid | معرف السجل (للتحديث/الحذف) |
| `operation` | text | `insert` \| `update` \| `delete` |
| `payload` | jsonb | بيانات العملية |
| `status` | text | `pending` \| `synced` \| `failed` |
| `retry_count` | integer | عدد المحاولات |
| `last_error` | text | آخر خطأ إن وُجد |
| `created_at` | timestamptz | وقت الإنشاء |
| `updated_at` | timestamptz | آخر تحديث |

## التدفق المقترح (للمستقبل)

1. **عند إجراء المستخدم (بدون نت):** إدراج صف في `sync_queue` بحالة `pending` مع `payload` كامل.
2. **عند عودة الاتصال:** عملية خلفية تقرأ الصفوف `pending` وتنفّذ على الجداول الفعلية ثم تحديث الحالة إلى `synced` أو `failed`.
3. **في حالة `failed`:** زيادة `retry_count` وتحديث `last_error` وإعادة المحاولة لاحقاً.

## الملاحظات

- RLS مفعّل: المستخدم يرى ويعدّل فقط صفوف الـ workspace الخاص به.
- الهيكل جاهز في قاعدة البيانات؛ ربط الواجهة وطابور محلي (مثلاً IndexedDB) يبقى مرحلة لاحقة.
