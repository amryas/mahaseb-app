# ويب هوك واتساب بيزنس API

استقبال رسائل واتساب من العملاء وحفظها في Firestore حتى تظهر في التطبيق تحت «طلبات واتساب الواردة».

## المتطلبات

- Node.js 18+
- حساب Meta للتطبيقات وواتساب بيزنس API مفعّل
- مشروع Firebase مع مفتاح خدمة (Service Account) للوصول إلى Firestore

## التثبيت

```bash
cd server
npm install
```

## متغيرات البيئة

| المتغير | الوصف |
|---------|--------|
| `VERIFY_TOKEN` أو `WHATSAPP_VERIFY_TOKEN` | نفس القيمة التي تضعها في إعدادات التطبيق (رمز التحقق للويب هوك) |
| `PORT` | منفذ السيرفر (افتراضي 3000) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | محتوى ملف مفتاح خدمة Firebase كـ JSON (نص واحد) |
| أو `GOOGLE_APPLICATION_CREDENTIALS` | مسار ملف مفتاح الخدمة (مثل `./firebase-key.json`) |

## التشغيل

```bash
export VERIFY_TOKEN=كلمة_السر_التي_اخترتها
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
npm start
```

أو أنشئ ملف `.env` واستخدمه مع حزمة مثل `dotenv` إن رغبت.

## ربط الرابط في Meta

1. من [Meta for Developers](https://developers.facebook.com) → تطبيقك → واتساب → Configuration.
2. في **Callback URL** ضع الرابط العام للسيرفر، مثلاً: `https://your-domain.com/webhook`
3. في **Verify Token** ضع نفس قيمة `VERIFY_TOKEN`.
4. احفظ وفعّل الاشتراك في حقل `messages`.

## في التطبيق

1. من **الإعدادات** أدخل **معرف رقم الهاتف (Phone Number ID)** من لوحة Meta.
2. أدخل **رمز التحقق (Verify Token)** بنفس القيمة المستخدمة في السيرفر.
3. احفظ الإعدادات (مع تفعيل Firebase حتى يُسجّل الرابط في السحابة).
4. من **ربط المتاجر** ستظهر «طلبات واتساب الواردة». استخدم **تحديث من السحابة** لجلب الطلبات الجديدة ثم **أضف كإيراد ومبيعة** لكل طلب.

## هيكل Firestore

- السيرفر يقرأ التطابق من: `whatsapp_phone_to_account/{phone_number_id}` → `{ uid, accountId }`.
- التطبيق يكتب هذا المستند عند حفظ الإعدادات (إذا كان `whatsappPhoneNumberId` معرّفاً).
- السيرفر يضيف الطلبات في: `users/{uid}/accounts/{accountId}` تحت الحقل `whatsapp_orders` (مصفوفة).
