import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { Notification, AlertSeverity } from '../../types';

const SEV_STYLE: Record<AlertSeverity, { border: string; bg: string; icon: string }> = {
  green: { border: 'border-green-500', bg: 'bg-green-900/10', icon: '✅' },
  yellow: { border: 'border-yellow-400', bg: 'bg-yellow-900/10', icon: '⚠️' },
  red: { border: 'border-orange-500', bg: 'bg-orange-900/15', icon: '🔴' },
  critical: { border: 'border-red-500', bg: 'bg-red-900/20', icon: '🚨' },
};

function NotificationCard({ notif }: { notif: Notification }) {
  const { markNotificationRead, respondToNotification } = useAppStore();
  const style = SEV_STYLE[notif.severity];
  const [responded, setResponded] = useState(false);

  return (
    <div className={`border-l-4 ${style.border} ${style.bg} rounded-r p-3 mb-2 ${!notif.read ? 'ring-1 ring-slate-600' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>{style.icon}</span>
          <span className="text-xs font-bold text-slate-200">{notif.title}</span>
        </div>
        {!notif.read && (
          <button
            className="text-xs text-slate-500 hover:text-slate-300 ml-2 shrink-0"
            onClick={() => markNotificationRead(notif.id)}
          >
            ✕
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{notif.message}</p>

      {notif.system_action && (
        <div className="mt-2 bg-slate-900/50 rounded p-2 text-xs">
          <span className="text-blue-400 font-bold">System action: </span>
          <span className="text-slate-300">{notif.system_action}</span>
        </div>
      )}

      {notif.current_status && (
        <div className="mt-1 text-xs text-slate-500">
          Status: <span className="text-slate-300">{notif.current_status}</span>
        </div>
      )}

      {notif.requires_user_action && !responded && notif.user_options && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-xs text-yellow-400 font-bold w-full mb-1">Choose action:</span>
          {notif.user_options.map((opt) => (
            <button
              key={opt}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded transition-colors"
              onClick={() => {
                respondToNotification(notif.id, opt);
                setResponded(true);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {responded && (
        <div className="mt-2 text-xs text-green-400">✅ Action acknowledged</div>
      )}

      <div className="mt-1 text-xs text-slate-600">
        {new Date(notif.ts * 1000).toUTCString().slice(0, 25)}
      </div>
    </div>
  );
}

export default function NotificationCenter() {
  const { notifications, unreadCount, markNotificationRead } = useAppStore();
  const [open, setOpen] = useState(false);

  const sorted = [...notifications].sort((a, b) => b.ts - a.ts);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        className="relative flex items-center gap-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm transition-colors"
        onClick={() => setOpen((p) => !p)}
      >
        <span>🔔</span>
        <span className="text-slate-300">Notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-9 w-96 max-h-[70vh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-slate-700">
            <span className="font-bold text-sm text-slate-200">
              Notifications {unreadCount > 0 && <span className="text-red-400">({unreadCount} unread)</span>}
            </span>
            <button
              className="text-xs text-slate-500 hover:text-slate-300"
              onClick={() => {
                sorted.forEach((n) => markNotificationRead(n.id));
              }}
            >
              Mark all read
            </button>
          </div>
          <div className="overflow-y-auto p-3">
            {sorted.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">No notifications</div>
            )}
            {sorted.map((n) => (
              <NotificationCard key={n.id} notif={n} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
