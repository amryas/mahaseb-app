import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSettings, saveSettings, getCurrentAccountId } from '../data/store';
import { isSupabaseEnabled, getSupabase } from '../supabase/config';
import { logSystemEvent } from '../services/monitoring';

const LS_PREFIX = 'mahaseb_daily_whatsapp';

function clampStr(v, max = 120) {
  return String(v || '').slice(0, max);
}

export function normalizeWhatsAppPhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // keep + and digits only
  let x = s.replace(/[^\d+]/g, '');
  // convert 00 prefix to +
  if (x.startsWith('00')) x = `+${x.slice(2)}`;
  // Egyptian defaults: 01xxxxxxxxx
  if (/^01\d{9}$/.test(x)) return `+20${x.slice(1)}`;
  if (/^20\d{10}$/.test(x)) return `+${x}`;
  if (/^\+20\d{10}$/.test(x)) return x;
  // fallback: +[8-15 digits]
  if (/^\+\d{8,15}$/.test(x)) return x;
  return '';
}

export function isValidReportTimeHHmm(v) {
  const s = String(v || '');
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function safeGet(key, fallback = '') {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {}
}

function todayIso10Local() {
  return new Date().toISOString().slice(0, 10);
}

function makeSentKey({ workspaceId, dateIso10, phone, type }) {
  return `${LS_PREFIX}_sent_${workspaceId || 'none'}_${dateIso10 || 'none'}_${clampStr(phone, 24)}_${type || 'full'}`;
}

function shouldSendNow(timeHHmm) {
  if (!isValidReportTimeHHmm(timeHHmm)) return false;
  const [h, m] = timeHHmm.split(':').map(Number);
  const now = new Date();
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  return now.getTime() >= t.getTime();
}

async function invokeSendDailyWhatsAppReport({ workspaceId, phone, reportType }) {
  try {
    if (!isSupabaseEnabled() || !workspaceId) return { ok: false, skipped: false, error: 'not_available' };
    const sb = getSupabase();
    if (!sb) return { ok: false, skipped: false, error: 'no_client' };
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, skipped: false, error: 'no_session' };

    const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
    const url = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    if (!url) return { ok: false, skipped: false, error: 'no_url' };

    const res = await fetch(`${url}/functions/v1/send_daily_whatsapp_report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        phone,
        report_type: reportType || 'full',
        date_iso10: todayIso10Local(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, skipped: false, error: data?.error || 'send_failed' };
    return { ok: !!data?.ok, skipped: !!data?.skipped, message: data?.message || null };
  } catch (e) {
    return { ok: false, skipped: false, error: e?.message || 'send_exception' };
  }
}

/**
 * Hook for daily WhatsApp report settings stored in workspace settings.
 * Debounced save; never throws.
 */
export function useWhatsAppReportSettings() {
  const [enabled, setEnabled] = useState(false);
  const [phoneRaw, setPhoneRaw] = useState('');
  const [timeHHmm, setTimeHHmm] = useState('21:00');
  const [reportType, setReportType] = useState('full');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const debounceRef = useRef(null);

  useEffect(() => {
    try {
      const s = getSettings();
      setEnabled(!!s.dailyWhatsAppReportEnabled);
      setPhoneRaw(s.dailyWhatsAppReportPhone || '');
      setTimeHHmm(s.dailyWhatsAppReportTime || '21:00');
      setReportType(s.dailyWhatsAppReportType || 'full');
    } catch (_) {}
  }, []);

  const phone = useMemo(() => normalizeWhatsAppPhone(phoneRaw), [phoneRaw]);

  const preview = useMemo(() => {
    const sales = '3500';
    const profit = '900';
    const exp = '500';
    const top = 'تيشرت';
    if (reportType === 'sales') {
      return `📊 تقرير اليوم:\n\n💰 المبيعات: ${sales} جنيه\n🔥 أفضل منتج: ${top}`;
    }
    if (reportType === 'profit') {
      return `📊 تقرير اليوم:\n\n📈 الربح: ${profit} جنيه\n💸 المصروفات: ${exp} جنيه`;
    }
    return `📊 تقرير اليوم:\n\n💰 المبيعات: ${sales} جنيه\n📈 الربح: ${profit} جنيه\n💸 المصروفات: ${exp} جنيه\n🔥 أفضل منتج: ${top}`;
  }, [reportType]);

  const validate = useCallback(() => {
    if (!enabled) return '';
    if (!phone) return 'رقم الواتساب غير صحيح. اكتب رقم مثل 01xxxxxxxxx أو +20...';
    if (!isValidReportTimeHHmm(timeHHmm)) return 'وقت التقرير غير صحيح.';
    if (!['sales', 'profit', 'full'].includes(reportType)) return 'نوع التقرير غير صحيح.';
    return '';
  }, [enabled, phone, timeHHmm, reportType]);

  const scheduleSave = useCallback((patch) => {
    try {
      setSaving(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          const s0 = getSettings();
          saveSettings({ ...s0, ...patch });
        } catch (_) {}
        setSaving(false);
      }, 500);
    } catch (_) {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    const msg = validate();
    setError(msg);
    // Always save (even invalid) as raw values; sending is blocked by validation.
    scheduleSave({
      dailyWhatsAppReportEnabled: !!enabled,
      dailyWhatsAppReportPhone: String(phoneRaw || ''),
      dailyWhatsAppReportTime: String(timeHHmm || '21:00'),
      dailyWhatsAppReportType: String(reportType || 'full'),
    });
  }, [enabled, phoneRaw, timeHHmm, reportType, validate, scheduleSave]);

  return {
    enabled,
    setEnabled,
    phoneRaw,
    setPhoneRaw,
    phoneNormalized: phone,
    timeHHmm,
    setTimeHHmm,
    reportType,
    setReportType,
    preview,
    error,
    saving,
  };
}

/**
 * Lightweight scheduler: call when app opens or after sync.
 * Never blocks UI. Never throws. No duplicates (per day).
 */
export async function maybeSendDailyWhatsAppReport({ onToast, reason = 'open', ignoreTime = false } = {}) {
  try {
    const s = getSettings();
    if (!s?.dailyWhatsAppReportEnabled) return { ok: false, skipped: true, reason: 'disabled' };
    const workspaceId = getCurrentAccountId();
    if (!workspaceId) return { ok: false, skipped: true, reason: 'no_workspace' };

    const phone = normalizeWhatsAppPhone(s.dailyWhatsAppReportPhone || '');
    if (!phone) return { ok: false, skipped: true, reason: 'no_phone' };

    const timeHHmm = s.dailyWhatsAppReportTime || '21:00';
    if (!ignoreTime && !shouldSendNow(timeHHmm)) return { ok: false, skipped: true, reason: 'before_time' };

    const type = s.dailyWhatsAppReportType || 'full';
    if (!['sales', 'profit', 'full'].includes(type)) return { ok: false, skipped: true, reason: 'bad_type' };

    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (offline) return { ok: false, skipped: true, reason: 'offline' };

    const dateIso10 = todayIso10Local();
    const sentKey = makeSentKey({ workspaceId, dateIso10, phone, type });
    if (safeGet(sentKey, '') === '1') return { ok: true, skipped: true, reason: 'already_sent' };

    const r = await invokeSendDailyWhatsAppReport({ workspaceId, phone, reportType: type });
    if (r.ok) {
      if (!r.skipped) safeSet(sentKey, '1');
      void logSystemEvent('daily_whatsapp_sent', 'Daily WhatsApp report attempted', { reason, ok: true, skipped: r.skipped, workspaceId });
      return { ok: true, skipped: !!r.skipped, reason: r.skipped ? 'no_activity' : 'sent' };
    }

    void logSystemEvent('daily_whatsapp_failed', 'Daily WhatsApp report failed', { reason, error: r.error || 'unknown', workspaceId });
    onToast?.('فشل إرسال التقرير، سيتم المحاولة لاحقًا', 'error');
    return { ok: false, skipped: false, reason: 'send_failed' };
  } catch (e) {
    void logSystemEvent('daily_whatsapp_failed', 'Daily WhatsApp report exception', { error: e?.message || 'unknown', reason });
    return { ok: false, skipped: false, reason: 'exception' };
  }
}

