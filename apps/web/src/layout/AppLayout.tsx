import { Bell, Eye, EyeOff, Wallet } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { useActiveSpace, useMe } from '../auth/session';
import { OfflineBanner } from '../components/OfflineBanner';
import { useHiddenValues } from '../lib/hidden-values';
import { useNotifications, useSwitchSpace } from '../lib/queries';
import { bottomNav, newEntry, sideNav, type NavItem } from './nav';

function Item({ item, size = 22 }: { item: NavItem; size?: number }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.to === '/'} className="nav-link">
      <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function NotificationBell() {
  const { data } = useNotifications();
  const unread = data?.unread ?? 0;
  return (
    <Link
      to="/notificacoes"
      className="icon-btn bell"
      aria-label={unread ? `Notificações, ${unread} não lidas` : 'Notificações'}
    >
      <Bell size={20} aria-hidden="true" />
      {unread > 0 && (
        <span className="bell__badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

/** Topo das telas: espaço atual, notificações e ocultar valores. */
export function TopBar({ title }: { title?: string }) {
  const space = useActiveSpace();
  const { data: me } = useMe();
  const switchSpace = useSwitchSpace();
  const { hidden, toggle } = useHiddenValues();
  const many = (me?.spaces.length ?? 0) > 1;
  return (
    <header className="topbar">
      <div className="topbar__space">
        <span>{title ? 'FinApp' : 'Espaço'}</span>
        {title || !many ? (
          <span>{title ?? space?.name ?? 'Pessoal'}</span>
        ) : (
          <select
            className="topbar__select"
            aria-label="Espaço ativo"
            value={space?.id ?? ''}
            disabled={switchSpace.isPending}
            onChange={(e) => switchSpace.mutate(e.target.value)}
          >
            {me?.spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.type === 'shared' ? ' (compartilhado)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="topbar__actions">
        <NotificationBell />
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          aria-pressed={hidden}
          aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
        >
          {hidden ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

export function AppLayout() {
  const NewIcon = newEntry.icon;
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Principal">
        <div className="sidebar__brand">
          <Wallet size={24} aria-hidden="true" />
          FinApp
        </div>
        <NavLink to={newEntry.to} className="btn btn--primary sidebar__new">
          <NewIcon size={20} aria-hidden="true" />
          {newEntry.label}
        </NavLink>
        {sideNav.map((item) => (
          <Item key={item.to} item={item} size={20} />
        ))}
      </nav>
      <main className="app__main">
        <OfflineBanner />
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Principal">
        {bottomNav.left.map((item) => (
          <Item key={item.to} item={item} />
        ))}
        <NavLink to={newEntry.to} className="fab" aria-label={newEntry.label}>
          <NewIcon size={26} strokeWidth={2.2} aria-hidden="true" />
        </NavLink>
        {bottomNav.right.map((item) => (
          <Item key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}
