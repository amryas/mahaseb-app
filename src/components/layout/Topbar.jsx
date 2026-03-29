import { useState } from 'react';
import { Menu, Search } from 'lucide-react';
import { NotificationBell } from '../NotificationCenter';

function cn(...p) {
  return p.filter(Boolean).join(' ');
}

function userInitials(user) {
  const n = user?.displayName || user?.email || '';
  const parts = n.split(/[\s@]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return '؟';
}

export default function Topbar({ title, onOpenNotifications, notifUnread, user, onOpenMobileMenu }) {
  const [q, setQ] = useState('');

  return (
    <header
      className={cn(
        'fixed top-0 z-40 flex h-14 items-center gap-3 px-4',
        'border-b border-white/10 bg-[#0B0F19]/80 backdrop-blur-xl',
        'left-0 right-0 lg:right-[calc(260px+1.5rem)]'
      )}
    >
      <button
        type="button"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-95 motion-reduce:active:scale-100 lg:hidden"
        onClick={onOpenMobileMenu}
        aria-label="القائمة"
      >
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-right text-lg font-bold text-white">{title}</h1>

      <div className="relative hidden max-w-xs flex-1 sm:block sm:max-w-md">
        <Search
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          strokeWidth={2}
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث سريع…"
          className="w-full rounded-xl border border-white/10 bg-[#111827] py-2.5 pr-10 pl-3 text-sm text-white transition-all duration-200 placeholder:text-gray-400 focus:border-saas-primary focus:outline-none focus:ring-2 focus:ring-saas-primary/25"
          dir="rtl"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <NotificationBell onOpen={onOpenNotifications} unreadCount={notifUnread} />
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-gray-700 to-saas-shell text-xs font-bold text-white ring-2 ring-white/10"
          title={user?.email || ''}
        >
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="h-full w-full object-cover" />
          ) : (
            userInitials(user)
          )}
        </div>
      </div>
    </header>
  );
}
