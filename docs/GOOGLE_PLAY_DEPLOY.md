# نشر تطبيق محاسب مشروعي على Google Play

## 1. إنشاء حساب مطوّر وحساب التطبيق

- ادخل إلى [Google Play Console](https://play.google.com/console).
- سجّل حساب مطوّر (مرة واحدة، رسوم 25 دولار).
- من "إنشاء تطبيق" اختر "تطبيق" وادخل اسم التطبيق (مثل: محاسب مشروعي).

---

## 2. إنشاء مفتاح التوقيع (Keystore)

يُستخدم لتوقيع التطبيق عند كل نشر. **احفظ الملف وكلمة المرور في مكان آمن**؛ فقدانها يمنعك من تحديث التطبيق على المتجر.

من مجلد المشروع (أو من `android/app`):

```bash
keytool -genkey -v -keystore release.keystore -alias mahaseb -keyalg RSA -keysize 2048 -validity 10000
```

ضع الملف `release.keystore` داخل مجلد `android/` (أو `android/app/`) ولا ترفعه إلى Git.

---

## 3. إعداد ملف التوقيع لـ Gradle

- انسخ الملف:
  - من: `android/keystore.properties.example`
  - إلى: `android/keystore.properties`
- افتح `android/keystore.properties` وعدّل القيم:

```properties
storeFile=release.keystore
storePassword=كلمة_مرور_المتجر
keyAlias=mahaseb
keyPassword=كلمة_مرور_المفتاح
```

إذا وضعت `release.keystore` داخل `android/app/` فاستخدم:

```properties
storeFile=app/release.keystore
```

**مهم:** أضف `android/keystore.properties` إلى `.gitignore` ولا ترفعه إلى Git.

---

## 4. بناء حزمة النشر (AAB)

Google Play يقبل **Android App Bundle (AAB)** وليس APK فقط.

```bash
# من جذر المشروع
npm run build:android:release
cd android
.\gradlew bundleRelease
```

على Linux/Mac استخدم: `./gradlew bundleRelease`

الملف الناتج:

`android/app/build/outputs/bundle/release/app-release.aab`

---

## 5. رفع التطبيق في Play Console

1. من Play Console اختر تطبيقك.
2. من القائمة: **الإنتاج** (أو **اختبار داخلي** للتجربة أولاً).
3. **إنشاء إصدار جديد**.
4. **رفع** ملف `app-release.aab`.
5. املأ **ملخص التحديث** (بالعربية أو الإنجليزية).
6. احفظ ثم **مراجعة الإصدار** ثم **بدء النشر**.

---

## 6. متطلبات قائمة المتجر

قبل النشر للمستخدمين تحتاج في Play Console إلى:

- **صورة أيقونة التطبيق** (512×512).
- **لقطة شاشة واحدة على الأقل** (هاتف).
- **وصف قصير** و**وصف تفصيلي**.
- **تصنيف المحتوى** (استبيان الموقع).
- **سياسة الخصوصية** (رابط صفحة).

---

## 7. تحديث الإصدار لاحقاً

عند كل تحديث جديد غيّر في `android/app/build.gradle`:

- `versionCode`: زِد رقم صحيح (مثلاً 2 ثم 3 …).
- `versionName`: مثل "1.0.1" أو "1.1.0".

ثم أعد البناء ورفع AAB جديد من نفس المسار أعلاه.
