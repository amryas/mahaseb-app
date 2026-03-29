# تفعيل الاشتراك يدوياً (واتساب + Supabase)

عندما يدفع العميل عبر واتساب (فودافون كاش أو انستا باي)، تفعّل اشتراكه بإضافة صف في جدول `subscriptions` في Supabase.

---

## 1) جدول الاشتراكات

تأكد من وجود الجدول في Supabase (SQL Editor):

```sql
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_subscriptions" ON public.subscriptions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## 2) الحصول على user_id الخاص بالمشترك

- من **Supabase Dashboard** → **Authentication** → **Users**: ابحث عن المستخدم بريده أو رقمه وانسخ **User UID**.
- أو اطلب من المشترك تسجيل الدخول مرة واحدة في التطبيق ثم ابحث عنه في نفس القائمة.

---

## 3) إدراج اشتراك يدوياً

استبدل `USER_UUID_HERE` بمعرف المستخدم، و`monthly` أو `yearly` حسب الخطة، وتاريخ انتهاء الاشتراك:

```sql
INSERT INTO public.subscriptions (user_id, plan_id, status, expires_at)
VALUES (
  'USER_UUID_HERE',
  'monthly',   -- أو 'yearly'
  'active',
  now() + interval '1 month'   -- للشهري: شهر من الآن. للسنوي: interval '1 year'
);
```

**أمثلة:**

- اشتراك شهري ينتهي بعد شهر:
  ```sql
  INSERT INTO public.subscriptions (user_id, plan_id, status, expires_at)
  VALUES ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'monthly', 'active', now() + interval '1 month');
  ```

- اشتراك سنوي:
  ```sql
  INSERT INTO public.subscriptions (user_id, plan_id, status, expires_at)
  VALUES ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'yearly', 'active', now() + interval '1 year');
  ```

بعد التنفيذ، عند فتح المشترك لصفحة الاشتراك في التطبيق سيظهر أن اشتراكه مفعّل حتى التاريخ المحدد.

---

## 4) مسار العمل المقترح

1. العميل يختار الخطة في التطبيق ويضغط **ادفع عبر واتساب**.
2. يفتح واتساب مع رسالة جاهزة (الخطة والسعر).
3. العميل يدفع (فودافون كاش/انستا باي) ويؤكد لك.
4. أنت تدخل إلى Supabase → Authentication → Users لتجد **User UID**.
5. تنفّذ الـ `INSERT` أعلاه بالـ `user_id` و `plan_id` و `expires_at` المناسبين.
6. تخبر العميل أن الاشتراك تم تفعيله (أو يحدث الصفحة في التطبيق ليرى الحالة).

---

## 5) اختياري: دفع آلي لاحقاً

عند الرغبة في التفعيل الفوري بدون خطوة يدوية، يمكن لاحقاً ربط بوابة دفع (PayMob، Accept، Stripe) واستدعاء Edge Function أو Webhook يدرج الصف في `subscriptions` تلقائياً بعد الدفع.
