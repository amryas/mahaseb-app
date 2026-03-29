import { useState, useEffect } from 'react';
import { getSyncQueueLength } from '../data/syncQueue';
import { isWorkspaceSaaSEnabled } from '../data/workspaceApi';

export default function SyncStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setQueueLength(getSyncQueueLength());
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // تحديث أقل تكراراً لتحسين الأداء (كل 8 ثوانٍ بدلاً من 2)
    const interval = setInterval(update, 8000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      clearInterval(interval);
    };
  }, []);

  const handleSyncNow = async () => {
    if (!online || queueLength === 0) return;
    await processSyncQueue(() => setQueueLength(getSyncQueueLength()));
    setQueueLength(getSyncQueueLength());
    onSyncClick?.();
  };

  if (!isWorkspaceSaaSEnabled()) return null;

  const status = !online ? 'offline' : queueLength > 0 ? 'pending' : 'connected';
  const label = status === 'offline' ? 'غير متصل' : status === 'pending' ? 'انتظار مزامنة' : 'متصل';
  const dotClass = `sync-dot sync-dot-${status}`;

  return (
    <div className="sync-status-wrap" title={label}>
      <span className={dotClass} aria-hidden />
      <span className="sync-status-label">{label}</span>
    </div>
  );
}
