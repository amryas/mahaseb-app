import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  getTransactions,
  getInvoices,
  saveInvoices,
  getSales,
  getProducts,
  getAccounts,
  getCurrentAccountId,
  setAfterSaveSync,
  ensureSingleAccount,
  DATA_SUFFIXES,
  mergeTransactionIntoCache,
  mergeSaleIntoCache,
} from './data/store';
import { getCacheUserId, pruneWorkspaceCacheByAge } from './data/cacheStore';
import {
  getTransactionsPaginated,
  getInvoicesPaginated,
  getSalesPaginated,
  getSubscriptionCache,
  getArchiveCutoffIso,
  getArchivedInvoicesFromServer,
  getDb,
  runPostOpenIntegrityChecks,
} from './data/indexedDbStore';
import {
  GLOBAL_SAFE_MODE_EVENT,
  isGlobalSafeMode,
  enterGlobalSafeMode,
  clearGlobalSafeMode,
} from './data/globalSafeMode';
import GlobalSafeModeScreen from './components/GlobalSafeModeScreen';
import NavErrorBoundary from './components/NavErrorBoundary';
import { archiveByAge, autoArchiveIfNeeded } from './data/indexedDbStore';
import { useAuth } from './contexts/AuthContext';
import AuthScreen from './components/AuthScreen';
import { setSyncUserId, syncAccountKeyToCloud, loadUserDataFromCloud, syncAccountsListToCloud } from './data/firestoreSync';
import { isSupabaseEnabled } from './supabase/config';
import { initSupabaseAndLoad, initAfterSupabaseLogin, syncAccountKeyToSupabase, ensureAllAccountsInSupabase, loadWorkspaceData } from './data/supabaseSync';
import { processSyncQueue, writeThroughOperation } from './data/syncQueue';
import {
  trackImportOrders,
} from './data/workspaceSync';
import { isWorkspaceSaaSEnabled } from './data/workspaceApi';
import { createDebouncedSync } from './utils/syncDebounce';
import Dashboard from './components/Dashboard';
import Transactions from './components/Transactions';
import Invoices from './components/Invoices';
import Clients from './components/Clients';
import Settings from './components/Settings';
import Products from './components/Products';
import Sales from './components/Sales';
import Debts from './components/Debts';
import ClientsInvoicesPage from './components/ClientsInvoicesPage';
import SuppliersPurchasesDebts from './components/SuppliersPurchasesDebts';
import Onboarding, { shouldShowOnboarding, dismissOnboarding } from './components/Onboarding';
import MorePage from './components/MorePage';
import NotificationCenter, { NotificationBell } from './components/NotificationCenter';
import SyncStatus from './components/SyncStatus';
import SyncBanner from './components/SyncBanner';
import SubscriptionBanner from './components/SubscriptionBanner';
import SubscriptionReminderBanner from './components/SubscriptionReminderBanner';
import SubscriptionExpiredModal from './components/SubscriptionExpiredModal';
import TrialCountdownGlobalBanner from './components/TrialCountdownGlobalBanner';
import { useSubscriptionReminder } from './hooks/useSubscriptionReminder';
import { useWorkspace } from './hooks/useWorkspace';
import { getAppBranding, getNotifications } from './data/store';
import { LIMIT_REACHED_MESSAGE } from './data/usageLimitsApi';
import { logSystemEvent } from './services/monitoring';
import { importSalesInChunks, ensureSalesSyncInterval } from './data/salesWriteService';
import { addTransaction as commitTransaction, deleteTransaction as removeTransactionRecord } from './data/transactionsWriteService';
import DbSizeWarningModal from './components/DbSizeWarningModal';
import { ensureSubscriptionAllowsWriteCentral } from './data/subscriptionWriteGuard';
import { BILLING_ERROR_CODES } from './data/billingErrors';
import { maybeSendDailyWhatsAppReport } from './hooks/useWhatsAppReportSettings';
import PageContainer from './components/ui/PageContainer';
import { AppLayout } from './components/layout';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  CircleMinus,
  BarChart3,
  MoreHorizontal,
  PlusCircle,
} from 'lucide-react';
import './App.css';
import { OP } from './data/operationTypes';

const PageFallback = () => <div className="page-loading">جاري التحميل...</div>;

const ReportsAndDaily = lazy(() => import('./components/ReportsAndDaily'));
const Reports = lazy(() => import('./components/Reports'));
const ImportData = lazy(() => import('./components/ImportData'));
const BackupRestore = lazy(() => import('./components/BackupRestore'));
const Subscriptions = lazy(() => import('./components/Subscriptions'));
const Pricing = lazy(() => import('./components/Pricing'));
const Admin = lazy(() => import('./components/Admin'));
const DailyReport = lazy(() => import('./components/DailyReport'));

const PAGES = {
  welcome: 'welcome',
  dashboard: 'dashboard',
  products: 'products',
  sales: 'sales',
  expense: 'expense',
  income: 'income',
  reportsAndDaily: 'reports_and_daily',
  clientsInvoices: 'clients_invoices',
  suppliersPurchasesDebts: 'suppliers_purchases_debts',
  dailyReport: 'daily_report',
  invoices: 'invoices',
  clients: 'clients',
  importExcel: 'import_excel',
  reports: 'reports',
  subscriptions: 'subscriptions',
  pricing: 'pricing',
  backup: 'backup',
  admin: 'admin',
  settings: 'settings',
  notifications: 'notifications',
  more: 'more',
};

const PAGE_TITLES = {
  [PAGES.dashboard]: 'لوحة التحكم',
  [PAGES.products]: 'المخزون',
  [PAGES.sales]: 'البيع',
  [PAGES.expense]: 'المصروفات',
  [PAGES.income]: 'الإيرادات',
  [PAGES.reportsAndDaily]: 'التقارير',
  [PAGES.more]: 'المزيد',
  [PAGES.clientsInvoices]: 'العملاء والفواتير',
  [PAGES.suppliersPurchasesDebts]: 'الموردين والمشتريات',
  [PAGES.dailyReport]: 'كشف يومي',
  [PAGES.invoices]: 'الفواتير',
  [PAGES.clients]: 'العملاء',
  [PAGES.importExcel]: 'استيراد Excel',
  [PAGES.reports]: 'التقارير التفصيلية',
  [PAGES.subscriptions]: 'الاشتراك',
  [PAGES.pricing]: 'الأسعار',
  [PAGES.backup]: 'نسخ احتياطي',
  [PAGES.admin]: 'الإدارة',
  [PAGES.settings]: 'الإعدادات',
  [PAGES.notifications]: 'الإشعارات',
  [PAGES.welcome]: 'مرحباً',
};

const MAIN_NAV = [
  { key: PAGES.dashboard, label: 'الرئيسية', Icon: LayoutDashboard },
  { key: PAGES.products, label: 'المخزون', Icon: Package },
  { key: PAGES.sales, label: 'البيع', Icon: ShoppingCart },
  { key: PAGES.expense, label: 'المصروفات', Icon: CircleMinus },
  { key: PAGES.reportsAndDaily, label: 'التقارير', Icon: BarChart3 },
  { key: PAGES.more, label: 'المزيد', Icon: MoreHorizontal },
];

export default function App() {
  const { user, loading, firebaseEnabled, authEnabled } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const currentAccountId = activeWorkspaceId ?? getCurrentAccountId();

  const [transactions, setTransactions] = useState(() => getTransactions());
  const [invoices, setInvoices] = useState(() => getInvoices());
  const [toast, setToast] = useState(null);
  const [dbSizeWarningOpen, setDbSizeWarningOpen] = useState(false);
  const [dbSizeWarningInfo, setDbSizeWarningInfo] = useState({ usageBytes: null, limitBytes: null });
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [branding, setBranding] = useState(() => getAppBranding());
  const [page, setPage] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('payment=success')) return PAGES.subscriptions;
    return PAGES.dashboard;
  });
  const [showGlobalSafeModeScreen, setShowGlobalSafeModeScreen] = useState(
    () => typeof window !== 'undefined' && isGlobalSafeMode()
  );

  useEffect(() => {
    const onSafeMode = () => setShowGlobalSafeModeScreen(true);
    if (typeof window !== 'undefined') {
      window.addEventListener(GLOBAL_SAFE_MODE_EVENT, onSafeMode);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(GLOBAL_SAFE_MODE_EVENT, onSafeMode);
      }
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await getDb();
        await runPostOpenIntegrityChecks();
      } catch {
        if (isGlobalSafeMode()) setShowGlobalSafeModeScreen(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_E2E !== '1' || typeof window === 'undefined') return;
    window.__MAHASEB_E2E__ = { enterGlobalSafeMode, clearGlobalSafeMode };
  }, []);

  useEffect(() => {
    ensureSingleAccount();
    setTransactions(getTransactions());
    setInvoices(getInvoices());
  }, []);

  useEffect(() => {
    ensureSalesSyncInterval();
  }, []);

  // Daily WhatsApp report scheduler (safe + non-blocking).
  // Triggers on app open / workspace change (after report time).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      void maybeSendDailyWhatsAppReport({ onToast: showToast, reason: 'open' });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [currentAccountId, user?.id]);

  // Safe cache bootstrap: first page only from IndexedDB
  useEffect(() => {
    const workspaceId = getCurrentAccountId();
    const userId = getCacheUserId();
    if (!workspaceId) return;
    void (async () => {
      // Safe cache bootstrap archiving/size-guard (avoid crashes with huge local datasets).
      await archiveByAge(workspaceId, userId);
      await autoArchiveIfNeeded(workspaceId, userId, (info) => {
        setDbSizeWarningInfo({ usageBytes: info?.usage, limitBytes: info?.limit });
        setDbSizeWarningOpen(true);
        void logSystemEvent('db_size_warning', 'IndexedDB usage over limit', { usageBytes: info?.usage, limitBytes: info?.limit });
      });
      // Safety net: keep localStorage cache bounded too (Dashboard/Reports may still touch it).
      const cutoffIso10 = getArchiveCutoffIso();
      pruneWorkspaceCacheByAge(workspaceId, userId, cutoffIso10);

      const [txPage, invPage, salesPage, subCache] = await Promise.all([
        getTransactionsPaginated(workspaceId, userId, { limit: 25, offset: 0 }),
        getInvoicesPaginated(workspaceId, userId, { limit: 25, offset: 0 }),
        getSalesPaginated(workspaceId, userId, { limit: 25, offset: 0 }),
        getSubscriptionCache(workspaceId, userId),
      ]);
      if (Array.isArray(txPage) && txPage.length > 0) {
        for (const row of txPage) mergeTransactionIntoCache(row);
        setTransactions(getTransactions());
      }
      if (Array.isArray(invPage) && invPage.length > 0) {
        saveInvoices(invPage);
        setInvoices(invPage);
      }
      if (Array.isArray(salesPage) && salesPage.length > 0) {
        for (const row of salesPage) mergeSaleIntoCache(row);
      }
      if (subCache) {
        // already used by subscription hooks via cache-backed API
      }
    })();
  }, []);

  const cloudLoadedFor = useRef(null);
  const supabaseLoadedFor = useRef(false);
  const workspaceLoadToken = useRef(0);
  useEffect(() => {
    const setupSyncCallback = () => {
      const doSync = (accountId, suffix, data) => {
        if (suffix === DATA_SUFFIXES.ADMIN_PIN) return;
        if (firebaseEnabled && user) syncAccountKeyToCloud(accountId, suffix, data);
        if (isSupabaseEnabled()) syncAccountKeyToSupabase(accountId, suffix, data);
      };
      const debouncedSync = createDebouncedSync(doSync);
      setAfterSaveSync((accountId, suffix, data) => {
        if (suffix === DATA_SUFFIXES.SALES || suffix === DATA_SUFFIXES.PRODUCTS) {
          doSync(accountId, suffix, data);
        } else {
          debouncedSync(accountId, suffix, data);
        }
      });
    };
    if (firebaseEnabled && user) {
      setSyncUserId(user.uid);
      setupSyncCallback();
      if (cloudLoadedFor.current !== user.uid) {
        cloudLoadedFor.current = user.uid;
        loadUserDataFromCloud(user.uid, async () => {
          setTransactions(getTransactions());
          setInvoices(getInvoices());
          syncAccountsListToCloud(user.uid);
          await ensureAllAccountsInSupabase();
        });
      }
    } else if (isSupabaseEnabled() && user) {
      setupSyncCallback();
      if (supabaseLoadedFor.current !== user.id) {
        supabaseLoadedFor.current = user.id;
        initAfterSupabaseLogin(user.id, () => {
          setTransactions(getTransactions());
          setInvoices(getInvoices());
        });
      }
    } else if (!authEnabled && isSupabaseEnabled() && !supabaseLoadedFor.current) {
      supabaseLoadedFor.current = true;
      initSupabaseAndLoad(() => {
        setTransactions(getTransactions());
        setInvoices(getInvoices());
      });
    } else {
      if (!firebaseEnabled) setupSyncCallback();
      else {
        cloudLoadedFor.current = null;
        setSyncUserId(null);
        setAfterSaveSync(null);
      }
    }
  }, [authEnabled, firebaseEnabled, user?.id, user?.uid]);

  // عند عودة الاتصال: معالجة طابور المزامنة ثم تحديث الـ cache من السحابة
  useEffect(() => {
    const onOnline = () => {
      processSyncQueue().then(() => {
        if (isWorkspaceSaaSEnabled() && currentAccountId) {
          const token = ++workspaceLoadToken.current;
          loadWorkspaceData(currentAccountId).then(() => {
            if (token !== workspaceLoadToken.current) return;
            setTransactions(getTransactions());
            setInvoices(getInvoices());
          });
        }
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [currentAccountId]);

  // Sync عند عودة التطبيق للواجهة (helps offline-first reliability)
  useEffect(() => {
    const run = () => {
      if (!isWorkspaceSaaSEnabled()) return;
      if (document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      processSyncQueue().then(() => {
        if (!currentAccountId) return;
        const token = ++workspaceLoadToken.current;
        loadWorkspaceData(currentAccountId).then(() => {
          if (token !== workspaceLoadToken.current) return;
          setTransactions(getTransactions());
          setInvoices(getInvoices());
        });
      });
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [currentAccountId]);

  useEffect(() => {
    if (!currentAccountId) return;
    if (isWorkspaceSaaSEnabled()) {
      const token = ++workspaceLoadToken.current;
      loadWorkspaceData(currentAccountId).then(() => {
        if (token !== workspaceLoadToken.current) return;
        setTransactions(getTransactions());
        setInvoices(getInvoices());
      });
      return;
    }
    setTransactions(getTransactions());
    setInvoices(getInvoices());
  }, [currentAccountId]);

  if (showGlobalSafeModeScreen || isGlobalSafeMode()) {
    return <GlobalSafeModeScreen onRecovered={() => setShowGlobalSafeModeScreen(false)} />;
  }

  if (authEnabled && (loading || !user)) {
    if (loading) return <div className="app-loading">جاري التحميل...</div>;
    return <AuthScreen />;
  }

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const ensureSubscriptionAllowsWrite = async () => {
    if (!isWorkspaceSaaSEnabled()) return true;
    const wid = getCurrentAccountId();
    if (!wid) return false;
    try {
      await ensureSubscriptionAllowsWriteCentral(wid, {});
      return true;
    } catch (e) {
      if (e?.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED) {
        showToast('انتهت الفترة التجريبية أو الاشتراك — هذه العملية للقراءة فقط.', 'error');
        setPage(PAGES.pricing);
        return false;
      }
      throw e;
    }
  };

  const addTransaction = async (t) => {
    showToast('جاري الحفظ...');
    const r = await commitTransaction({
      ...t,
      id: t.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`),
    });
    if (!r.ok) {
      if (r.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED || r.error === 'subscription_required') {
        showToast('انتهت الفترة التجريبية أو الاشتراك — هذه العملية للقراءة فقط.', 'error');
        setPage(PAGES.pricing);
        return;
      }
      if (r.code === BILLING_ERROR_CODES.PLAN_LIMIT_REACHED || r.error === 'plan_limit_reached') {
        showToast(LIMIT_REACHED_MESSAGE, 'error');
        setPage(PAGES.pricing);
        return;
      }
      showToast('تعذر حفظ الحركة محلياً.', 'error');
      return;
    }
    setTransactions(getTransactions());
    showToast(
      isWorkspaceSaaSEnabled() && typeof navigator !== 'undefined' && !navigator.onLine
        ? 'تم الحفظ على الجهاز فقط (غير متصل)'
        : 'تم الحفظ ✓'
    );
  };

  const importTransactions = async (list) => {
    if (!list?.length) return;
    if (isWorkspaceSaaSEnabled()) {
      const canWrite = await ensureSubscriptionAllowsWrite();
      if (!canWrite) return;
    }
    let ok = 0;
    for (const raw of list) {
      const t = {
        ...raw,
        id: raw.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${ok}`),
      };
      const r = await commitTransaction(t, { skipSubscriptionNetwork: ok > 0 });
      if (!r.ok) {
        if (r.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED || r.error === 'subscription_required') {
          showToast('انتهت الفترة التجريبية أو الاشتراك — الاستيراد متوقف.', 'error');
          setPage(PAGES.pricing);
          setTransactions(getTransactions());
          return;
        }
        showToast(`تعذر استيراد بعض الحركات (توقف عند ${ok}).`, 'error');
        setTransactions(getTransactions());
        return;
      }
      ok += 1;
    }
    setTransactions(getTransactions());
    showToast(`تم استيراد ${list.length} حركة بنجاح`);
  };

  const importSales = async (list, importOptions = {}) => {
    if (!list?.length) return;
    const withIds = list.map((s) => ({
      ...s,
      id: s.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    }));
    const res = await importSalesInChunks(withIds, {
      chunkSize: importOptions.chunkSize ?? 50,
      onProgress: importOptions.onProgress,
      signal: importOptions.signal,
    });
    if (!res.ok) {
      showToast(res.aborted ? 'تم إلغاء الاستيراد' : 'تعذر استيراد بعض المبيعات', 'error');
      return;
    }
    for (let i = 0; i < withIds.length; i++) {
      const s = withIds[i];
      if (!s.paid) continue;
      const sid = s.id;
      if (!sid) continue;
      const r = await commitTransaction(
        {
          id: crypto.randomUUID(),
          type: 'income',
          description: `بيع مستورد: ${s.productName} - ${s.clientName}`,
          amount: s.total,
          category: 'مبيعات',
          date: s.date,
          source: 'excel_import_sale',
          saleId: sid,
        },
        { skipSubscriptionNetwork: i > 0 }
      );
      if (!r.ok) {
        if (r.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED || r.error === 'subscription_required') {
          showToast('انتهت الفترة التجريبية أو الاشتراك — الاستيراد متوقف.', 'error');
          setPage(PAGES.pricing);
        } else {
          showToast('تعذر تسجيل بعض الإيرادات المرتبطة بالاستيراد.', 'error');
        }
        setTransactions(getTransactions());
        return;
      }
    }
    setTransactions(getTransactions());
    showToast(`تم استيراد ${res.imported} عملية بيع`);
    if (isWorkspaceSaaSEnabled()) await trackImportOrders();
  };
  const deleteTransaction = async (id) => {
    const r = await removeTransactionRecord(id);
    if (!r.ok) {
      if (r.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED || r.error === 'subscription_required') {
        showToast('انتهت الفترة التجريبية أو الاشتراك — هذه العملية للقراءة فقط.', 'error');
        setPage(PAGES.pricing);
        return;
      }
      showToast('تعذر حذف الحركة محلياً.', 'error');
      return;
    }
    setTransactions(getTransactions());
    showToast('تم الحذف');
  };

  const addInvoice = async (inv) => {
    showToast('جاري الحفظ...');
    if (isWorkspaceSaaSEnabled()) {
      const wid = getCurrentAccountId();
      if (wid) {
        const saved = await writeThroughOperation({
          type: OP.INSERT_INVOICE,
          workspaceId: wid,
          payload: {
            id: inv.id,
            client: inv.client,
            amount: inv.amount,
            description: inv.description,
            dueDate: inv.dueDate,
            paid: inv.paid,
          },
          dedupeKey: `insert_invoice:${wid}:${inv.id}`,
          latestUpdatedAt: inv?.updatedAt,
        });
        if (!saved) {
          showToast('لا يمكن حفظ الفاتورة — تحقق من الاشتراك أو حدود الخطة.', 'error');
          setPage(PAGES.pricing);
          return;
        }
        setInvoices((prev) => [...prev, inv]);
        showToast(navigator.onLine ? 'تم الحفظ ✓' : 'تم الحفظ على الجهاز فقط (غير متصل)');
        return;
      }
      showToast('فشل الحفظ: مساحة العمل غير متاحة', 'error');
    } else {
      setInvoices((prev) => {
        const next = [...prev, inv];
        saveInvoices(next);
        return next;
      });
      showToast('تم الحفظ ✓');
    }
  };
  const deleteInvoice = async (id) => {
    if (isWorkspaceSaaSEnabled()) {
      const wid = getCurrentAccountId();
      if (wid) {
        const ok = await writeThroughOperation({
          type: OP.DELETE_INVOICE,
          workspaceId: wid,
          payload: { invoiceId: id },
          dedupeKey: `delete_invoice:${wid}:${id}`,
        });
        if (!ok) {
          showToast('لا يمكن الحذف — تحقق من حالة الاشتراك.', 'error');
          setPage(PAGES.pricing);
          return;
        }
        setInvoices((prev) => prev.filter((x) => x.id !== id));
        showToast('تم حذف الفاتورة');
        return;
      }
      showToast('فشل الحذف: مساحة العمل غير متاحة', 'error');
    } else {
      setInvoices((prev) => {
        const next = prev.filter((x) => x.id !== id);
        saveInvoices(next);
        return next;
      });
      showToast('تم حذف الفاتورة');
    }
  };
  const toggleInvoicePaid = async (id) => {
    if (isWorkspaceSaaSEnabled()) {
      const inv = invoices.find((i) => i.id === id);
      if (inv) {
        const wid = getCurrentAccountId();
        if (wid) {
          const ok = await writeThroughOperation({
            type: OP.UPDATE_INVOICE,
            workspaceId: wid,
            payload: { invoiceId: id, updates: { paid: !inv.paid } },
            dedupeKey: `update_invoice:${wid}:${id}:paid:${!inv.paid}`,
            latestUpdatedAt: inv?.updatedAt,
          });
          if (!ok) {
            showToast('لا يمكن التحديث — تحقق من حالة الاشتراك.', 'error');
            setPage(PAGES.pricing);
            return;
          }
        }
        setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, paid: !i.paid } : i)));
      }
    } else {
      setInvoices((prev) => {
        const next = prev.map((i) => (i.id === id ? { ...i, paid: !i.paid } : i));
        saveInvoices(next);
        return next;
      });
    }
  };

  const loadMoreInvoices = async (offset) => {
    if (!isWorkspaceSaaSEnabled()) return 0;
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    if (!wid || !uid) return 0;
    const next = await getInvoicesPaginated(wid, uid, { limit: 25, offset: Number(offset) || 0 });
    if (!Array.isArray(next) || next.length === 0) return 0;
    setInvoices((prev) => {
      const map = new Map((prev || []).map((i) => [i.id, i]));
      for (const inv of next) map.set(inv.id, inv);
      return Array.from(map.values());
    });
    return next.length;
  };

  const loadArchivedOlderInvoices = async (serverPage) => {
    // Read older invoices from server and extend local cache (IDB + localStorage).
    if (!isWorkspaceSaaSEnabled()) return 0;
    const wid = getCurrentAccountId();
    if (!wid) return 0;
    try {
      const rows = await getArchivedInvoicesFromServer(wid, Number(serverPage) || 0, 25);
      if (!Array.isArray(rows) || rows.length === 0) return 0;
      setInvoices((prev) => {
        const map = new Map((prev || []).map((i) => [i.id, i]));
        for (const inv of rows) map.set(inv.id, inv);
        const next = Array.from(map.values());
        next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        // Persist combined list (best-effort cache extension).
        saveInvoices(next);
        return next;
      });
      return rows.length;
    } catch (e) {
      return 0;
    }
  };

  const handleRestore = () => {
    setTransactions(getTransactions());
    setInvoices(getInvoices());
  };

  const refreshBranding = () => setBranding(getAppBranding());

  return (
    <>
      <MainShell
        page={page}
        setPage={setPage}
        transactions={transactions}
        setTransactions={setTransactions}
        invoices={invoices}
        setInvoices={setInvoices}
        addTransaction={addTransaction}
        importTransactions={importTransactions}
        importSales={importSales}
        deleteTransaction={deleteTransaction}
        addInvoice={addInvoice}
        deleteInvoice={deleteInvoice}
        toggleInvoicePaid={toggleInvoicePaid}
        handleRestore={handleRestore}
        showToast={showToast}
        toast={toast}
        branding={branding}
        refreshBranding={refreshBranding}
        adminLoggedIn={adminLoggedIn}
        setAdminLoggedIn={setAdminLoggedIn}
      />
      <DbSizeWarningModal
        open={dbSizeWarningOpen}
        usageBytes={dbSizeWarningInfo?.usageBytes}
        limitBytes={dbSizeWarningInfo?.limitBytes}
        onClose={() => setDbSizeWarningOpen(false)}
      />
    </>
  );
}

function SubscriptionExpiredModalGate({ onGoToPricing }) {
  const { showExpiredPopup } = useSubscriptionReminder();
  const [dismissed, setDismissed] = useState(false);
  const e2eSkipAuth = typeof window !== 'undefined' && localStorage.getItem('e2e_skip_auth') === '1';
  const open = showExpiredPopup && !dismissed && !e2eSkipAuth;
  const handleClose = () => {
    setDismissed(true);
    try {
      localStorage.setItem('subscription_expired_popup_shown', '1');
    } catch (_) {}
  };
  return (
    <SubscriptionExpiredModal
      open={open}
      onClose={handleClose}
      onGoToPricing={onGoToPricing}
    />
  );
}

function MainShell(props) {
  const { user } = useAuth();
  const {
    page,
    setPage,
    transactions,
    setTransactions,
    invoices,
    setInvoices,
    addTransaction,
    importTransactions,
    importSales,
    deleteTransaction,
    addInvoice,
    deleteInvoice,
    toggleInvoicePaid,
    handleRestore,
    showToast,
    toast,
    branding,
    refreshBranding,
    adminLoggedIn,
    setAdminLoggedIn,
  } = props;

  const [onboardingClosed, setOnboardingClosed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notifUnread, setNotifUnread] = useState(0);
  const refreshNotifCount = () => setNotifUnread(getNotifications().filter((n) => !n.read).length);
  useEffect(() => {
    refreshNotifCount();
  }, [page, notificationPanelOpen]);
  const isFirstWorkspace = (getAccounts()?.length || 0) <= 1;
  const showOnboarding = !onboardingClosed && shouldShowOnboarding() && isFirstWorkspace && getProducts().length === 0 && getSales().length === 0;

  const mobileNavItems = [
    { key: PAGES.dashboard, label: 'الرئيسية', icon: '◉' },
    { key: PAGES.products, label: 'المخزون', icon: '📦' },
    { key: PAGES.sales, label: 'البيع', icon: '🛒' },
    { key: PAGES.reportsAndDaily, label: 'التقارير', icon: '▤' },
  ];

  return (
    <>
      {/* قائمة الموبايل (drawer) */}
      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} role="presentation">
          <div className="mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <h2>القائمة</h2>
              <button type="button" className="mobile-drawer-close" onClick={() => setMobileMenuOpen(false)} aria-label="إغلاق">×</button>
            </div>
            <nav className="mobile-drawer-nav">
              <button type="button" className={`mobile-drawer-item ${page === PAGES.more ? 'active' : ''}`} onClick={() => { setPage(PAGES.more); setMobileMenuOpen(false); }}>☰ المزيد</button>
              <button type="button" className={`mobile-drawer-item ${page === PAGES.expense ? 'active' : ''}`} onClick={() => { setPage(PAGES.expense); setMobileMenuOpen(false); }}>⊖ المصروفات</button>
              <button type="button" className={`mobile-drawer-item ${page === PAGES.clientsInvoices ? 'active' : ''}`} onClick={() => { setPage(PAGES.clientsInvoices); setMobileMenuOpen(false); }}>👤 العملاء</button>
              <button type="button" className={`mobile-drawer-item ${page === PAGES.suppliersPurchasesDebts ? 'active' : ''}`} onClick={() => { setPage(PAGES.suppliersPurchasesDebts); setMobileMenuOpen(false); }}>🚚 الموردين</button>
              <button type="button" className={`mobile-drawer-item ${page === PAGES.settings ? 'active' : ''}`} onClick={() => { setPage(PAGES.settings); setMobileMenuOpen(false); }}>⚙ الإعدادات</button>
            </nav>
          </div>
        </div>
      )}

      {notificationPanelOpen && (
        <div className="notification-overlay" onClick={() => setNotificationPanelOpen(false)} role="presentation">
          <div className="notification-panel" onClick={(e) => e.stopPropagation()}>
            <div className="notification-panel-head">
              <span>الإشعارات</span>
              <button type="button" className="notification-panel-close" onClick={() => setNotificationPanelOpen(false)} aria-label="إغلاق">×</button>
            </div>
            <NotificationCenter
              onNavigate={(link) => { setPage(link); setNotificationPanelOpen(false); }}
              onClose={() => setNotificationPanelOpen(false)}
              onRefresh={refreshNotifCount}
            />
          </div>
        </div>
      )}

      <AppLayout
        branding={branding}
        activePageKey={page}
        onNavigate={setPage}
        navItems={MAIN_NAV}
        sidebarFooter={
          <div className="[&_.sync-status-wrap]:mx-0 [&_.sync-status-wrap]:mb-0 [&_.sync-status-wrap]:mt-0 [&_.sync-status-wrap]:bg-white/[0.06] [&_.sync-status-wrap]:text-gray-300">
            <SyncStatus />
          </div>
        }
        pageTitle={PAGE_TITLES[page] || branding.appName || 'محاسب مشروعي'}
        user={user}
        notifUnread={notifUnread}
        onOpenNotifications={() => setNotificationPanelOpen(true)}
        setMobileMenuOpen={setMobileMenuOpen}
      >
        {showOnboarding && (
          <Onboarding
            onFirstStep={(target) => {
              dismissOnboarding();
              setOnboardingClosed(true);
              const pageMap = {
                products: PAGES.products,
                sales: PAGES.sales,
                expense: PAGES.expense,
                dashboard: PAGES.dashboard,
              };
              setPage(pageMap[target] || PAGES.dashboard);
            }}
            onDismiss={() => {
              dismissOnboarding();
              setOnboardingClosed(true);
            }}
          />
        )}

        <SyncBanner
          onSynced={() => {
            void maybeSendDailyWhatsAppReport({ onToast: showToast, reason: 'sync' });
          }}
        />
        {isSupabaseEnabled() && user && (
          <>
            <TrialCountdownGlobalBanner onGoToPricing={() => setPage(PAGES.pricing)} />
            <SubscriptionBanner onGoToPricing={() => setPage(PAGES.pricing)} />
            <SubscriptionReminderBanner onGoToPricing={() => setPage(PAGES.pricing)} />
          </>
        )}
        {isSupabaseEnabled() && user && (
          <SubscriptionExpiredModalGate onGoToPricing={() => setPage(PAGES.pricing)} />
        )}

        <NavErrorBoundary>
          <main className="min-w-0 pb-20 lg:pb-6">
            <PageContainer>
        {page === PAGES.more && (
          <MorePage
            onNavigate={(key) => setPage(key)}
            items={[
              { key: PAGES.clientsInvoices, label: 'العملاء', icon: '👤', desc: 'العملاء والفواتير' },
              { key: PAGES.suppliersPurchasesDebts, label: 'الموردين', icon: '🚚', desc: 'الموردين والمشتريات' },
              { key: PAGES.pricing, label: 'الاشتراك', icon: '📋', desc: 'الخطط والأسعار' },
              { key: PAGES.importExcel, label: 'استيراد Excel', icon: '📥', desc: 'استيراد بيانات' },
              { key: PAGES.backup, label: 'نسخ احتياطي', icon: '💾', desc: 'تصدير واستعادة' },
              { key: PAGES.settings, label: 'الإعدادات', icon: '⚙', desc: 'بيانات الشركة' },
            ]}
          />
        )}
        {page === PAGES.dashboard && (
          <Dashboard
            transactions={transactions}
            invoices={invoices}
            onGoToSales={() => setPage(PAGES.sales)}
            onGoToExpense={() => setPage(PAGES.expense)}
            onGoToProducts={() => setPage(PAGES.products)}
            onGoToReports={() => setPage(PAGES.reportsAndDaily)}
            onGoToPricing={() => setPage(PAGES.pricing)}
            hideEngagementChrome={showOnboarding}
            onToast={showToast}
            bannerImage={branding.bannerBase64}
          />
        )}
        {page === PAGES.products && (
          <Products
            onToast={showToast}
            onGoToSubscription={() => setPage(PAGES.pricing)}
          />
        )}
        {page === PAGES.sales && (
          <Sales
            onToast={showToast}
            onGoToSubscription={() => setPage(PAGES.pricing)}
          />
        )}
        {page === PAGES.expense && (
          <Transactions
            type="expense"
            transactions={transactions}
            onAdd={addTransaction}
            onDelete={deleteTransaction}
            onGoToSubscription={() => setPage(PAGES.pricing)}
          />
        )}
        {page === PAGES.reportsAndDaily && (
          <Suspense fallback={<PageFallback />}>
            <ReportsAndDaily transactions={transactions} invoices={invoices} onToast={showToast} />
          </Suspense>
        )}
        {page === PAGES.clientsInvoices && (
          <ClientsInvoicesPage
            invoices={invoices}
            onAddInvoice={addInvoice}
            onDeleteInvoice={deleteInvoice}
            onToggleInvoicePaid={toggleInvoicePaid}
            onToast={showToast}
          />
        )}
        {page === PAGES.suppliersPurchasesDebts && (
          <SuppliersPurchasesDebts onToast={showToast} />
        )}
        {page === PAGES.dailyReport && (
          <Suspense fallback={<PageFallback />}>
            <DailyReport transactions={transactions} />
          </Suspense>
        )}
        {page === PAGES.invoices && (
          <Invoices
            invoices={invoices}
            onAdd={addInvoice}
            onDelete={deleteInvoice}
            onTogglePaid={toggleInvoicePaid}
            onLoadMoreInvoices={loadMoreInvoices}
            onLoadArchivedInvoices={loadArchivedOlderInvoices}
          />
        )}
        {page === PAGES.clients && <Clients />}
        {page === PAGES.importExcel && (
          <Suspense fallback={<PageFallback />}>
            <ImportData onImport={importTransactions} onImportSales={importSales} onToast={showToast} />
          </Suspense>
        )}
        {page === PAGES.reports && (
          <Suspense fallback={<PageFallback />}>
            <Reports transactions={transactions} invoices={invoices} onToast={showToast} />
          </Suspense>
        )}
        {page === PAGES.subscriptions && <Subscriptions onToast={showToast} />}
        {page === PAGES.pricing && (
          <Suspense fallback={<PageFallback />}>
            <Pricing onSubscribe={() => setPage(PAGES.subscriptions)} />
          </Suspense>
        )}
        {page === PAGES.backup && (
          <Suspense fallback={<PageFallback />}>
            <BackupRestore onRestore={handleRestore} onToast={showToast} />
          </Suspense>
        )}
        {page === PAGES.admin && (
          <Suspense fallback={<PageFallback />}>
            <Admin
              isLoggedIn={adminLoggedIn}
              onLogin={setAdminLoggedIn}
              onToast={showToast}
              onBrandingSaved={refreshBranding}
            />
          </Suspense>
        )}
        {page === PAGES.settings && (
          <Settings
            onSave={() => showToast('تم الحفظ')}
            onNavigate={(key) => setPage(PAGES[key] || PAGES.settings)}
            onToast={showToast}
          />
        )}
            </PageContainer>
          </main>
        </NavErrorBoundary>
      </AppLayout>

      {/* شريط تنقل سفلي للموبايل */}
      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {mobileNavItems.map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            className={`bottom-nav-item ${page === key ? 'active' : ''}`}
            onClick={() => setPage(key)}
          >
            <span className="bottom-nav-icon">{icon}</span>
            <span className="bottom-nav-label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`bottom-nav-item ${[PAGES.more, PAGES.expense, PAGES.clientsInvoices, PAGES.suppliersPurchasesDebts, PAGES.settings, PAGES.importExcel, PAGES.backup].includes(page) ? 'active' : ''}`}
          onClick={() => setPage(PAGES.more)}
        >
          <span className="bottom-nav-icon">☰</span>
          <span className="bottom-nav-label">المزيد</span>
        </button>
      </nav>

      <button
        type="button"
        className="fab-new-sale"
        onClick={() => setPage(PAGES.sales)}
        aria-label="بيع جديد"
      >
        <PlusCircle className="fab-new-sale-icon" strokeWidth={2} aria-hidden />
        <span className="fab-new-sale-text">بيع جديد</span>
      </button>

      {toast && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.message}
        </div>
      )}
    </>
  );
}
