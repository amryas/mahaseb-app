/**
 * ويب هوك لاستقبال رسائل واتساب بيزنس API
 * يتحقق من الرابط ثم يحفظ الرسائل الواردة في Firestore
 *
 * المتطلبات:
 * - متغير بيئة VERIFY_TOKEN (نفس القيمة في إعدادات التطبيق)
 * - متغير بيئة GOOGLE_APPLICATION_CREDENTIALS يشير لملف خدمة Firebase، أو FIREBASE_SERVICE_ACCOUNT_JSON كـ JSON string
 *
 * في لوحة Meta للتطبيقات: Callback URL = https://your-domain.com/webhook
 * Verify Token = نفس VERIFY_TOKEN
 */

import express from 'express';
import admin from 'firebase-admin';

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || '';

function getFirestore() {
  if (!admin.apps.length) {
    const cred = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (cred) {
      try {
        const key = JSON.parse(cred);
        admin.initializeApp({ credential: admin.credential.cert(key) });
      } catch (e) {
        console.error('FIREBASE_SERVICE_ACCOUNT_JSON invalid');
        process.exit(1);
      }
    } else {
      admin.initializeApp();
    }
  }
  return admin.firestore();
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');
  const body = req.body;
  if (!body.object || body.object !== 'whatsapp_business_account') return;
  const entries = body.entry || [];
  const db = getFirestore();
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || entry.id;
      const messages = value.messages || [];
      for (const msg of messages) {
        const from = value.contacts?.[0]?.profile?.name || msg.from || '';
        const text = msg.text?.body || msg.body?.text || '';
        const id = msg.id;
        const timestamp = msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now();
        try {
          const mapRef = db.collection('whatsapp_phone_to_account').doc(String(phoneNumberId));
          const mapSnap = await mapRef.get();
          if (!mapSnap.exists()) continue;
          const { uid, accountId } = mapSnap.data();
          if (!uid || !accountId) continue;
          const accountRef = db.collection('users').doc(uid).collection('accounts').doc(accountId);
          const accountSnap = await accountRef.get();
          const current = accountSnap.exists ? accountSnap.data() : {};
          const orders = Array.isArray(current.whatsapp_orders) ? current.whatsapp_orders : [];
          orders.push({
            id,
            from: String(msg.from),
            from_name: from,
            text,
            timestamp: new Date(timestamp).toISOString(),
          });
          await accountRef.set({ whatsapp_orders: orders, updatedAt: new Date().toISOString() }, { merge: true });
        } catch (e) {
          console.error('Webhook save error:', e.message);
        }
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp webhook server on port ${PORT}. VERIFY_TOKEN set: ${Boolean(VERIFY_TOKEN)}`);
});
