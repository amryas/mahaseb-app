import { useState, useEffect } from 'react';
import { getSyncQueueLength, processSyncQueue } from '../data/syncQueue';
import { isWorkspaceSaaSEnabled } from '../data/workspaceApi';

export default function SyncBanner({ onSynced }) {
  const [queueLength, setQueueLength] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const update = () => setQueueLength(getSyncQueueLength());
    update();
    // تحديث أقل تكراراً لتحسين الأداء (كل 8 ثوانٍ بدلاً من 2)
    const interval = setInterval(update, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncNow = async () => {
    if (queueLength === 0 || syncing) return;
    setSyncing(true);
    await processSyncQueue();
    setQueueLength(getSyncQueueLength());
    setSyncing(false);
    onSynced?.();
  };

  if (!isWorkspaceSaaSEnabled() || queueLength === 0) return null;

  return (
    <div className="sync-banner">
      <span className="sync-banner-text">هناك عمليات لم تتم مزامنتها بعد</span>
      <button type="button" className="btn-primary btn-sync-now" onClick={handleSyncNow} disabled={syncing}>
        {syncing ? 'جاري المزامنة...' : 'مزامنة الآن'}
      </button>
    </div>
  );
}
