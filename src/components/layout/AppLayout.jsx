import Sidebar from './Sidebar';
import Topbar from './Topbar';

/**
 * Shell: RTL sidebar (physical right) + fixed top bar + scrollable main.
 * Business logic stays in parent; this file is structure + styling only.
 */
export default function AppLayout({
  branding,
  activePageKey,
  onNavigate,
  navItems,
  sidebarFooter,
  pageTitle,
  user,
  notifUnread,
  onOpenNotifications,
  setMobileMenuOpen,
  children,
}) {
  return (
    <div className="flex min-h-screen min-h-[100dvh] bg-[#0B0F19] text-white">
      <Sidebar
        branding={branding}
        activeKey={activePageKey}
        items={navItems}
        onNavigate={onNavigate}
        footer={sidebarFooter}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={pageTitle}
          user={user}
          notifUnread={notifUnread}
          onOpenNotifications={onOpenNotifications}
          onOpenMobileMenu={() => setMobileMenuOpen?.(true)}
        />
        <div className="flex-1 overflow-x-hidden overflow-y-auto pt-14">{children}</div>
      </div>
    </div>
  );
}
