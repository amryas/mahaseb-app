import { useState, useEffect } from 'react';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  formatDate,
} from '../data/store';
import './NotificationCenter.css';

export default function NotificationCenter({ onNavigate, onClose, onRefresh }) {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    setNotifications(getNotifications());
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkRead = (id) => {
    markNotificationRead(id);
    setNotifications(getNotifications());
    onRefresh?.();
  };

  const handleMarkAllRead = () => {
    markAllNotificationsRead();
    setNotifications(getNotifications());
    onRefresh?.();
  };

  const handleLink = (n) => {
    if (n.link) {
      onNavigate?.(n.link);
      if (!n.read) handleMarkRead(n.id);
    }
    onClose?.();
  };

  return (
    <div className="notification-center-wrap">
      <div className="notification-center-header">
        <h3 className="notification-center-title">الإشعارات والتنبيهات</h3>
        {unreadCount > 0 && (
          <button type="button" className="btn-secondary btn-sm" onClick={handleMarkAllRead}>
            تعليم الكل كمقروء
          </button>
        )}
      </div>
      <div className="notification-list">
        {notifications.length === 0 ? (
          <p className="notification-empty">لا توجد إشعارات.</p>
        ) : (
          notifications.slice(0, 30).map((n) => (
            <div
              key={n.id}
              className={`notification-item notification-${n.type} ${n.read ? 'read' : ''}`}
              onClick={() => n.link && handleLink(n)}
              role={n.link ? 'button' : 'article'}
              tabIndex={n.link ? 0 : -1}
              onKeyDown={(e) => n.link && (e.key === 'Enter' || e.key === ' ') && handleLink(n)}
            >
              <div className="notification-item-head">
                <span className="notification-type-icon">
                  {n.type === 'warning' ? '⚠' : n.type === 'error' ? '✕' : n.type === 'success' ? '✓' : '◉'}
                </span>
                <strong className="notification-title">{n.title}</strong>
                {!n.read && <span className="notification-dot" />}
              </div>
              {n.message && <p className="notification-message">{n.message}</p>}
              <div className="notification-meta">
                <span className="notification-date">
                  {n.createdAt ? new Date(n.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                </span>
                {n.link && n.linkLabel && (
                  <span className="notification-link-label">{n.linkLabel} ←</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function NotificationBell({ onOpen, unreadCount }) {
  return (
    <button
      type="button"
      className="notification-bell"
      onClick={onOpen}
      aria-label={unreadCount > 0 ? `${unreadCount} إشعار غير مقروء` : 'الإشعارات'}
    >
      <span className="notification-bell-icon">🔔</span>
      {unreadCount > 0 && <span className="notification-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
  );
}
