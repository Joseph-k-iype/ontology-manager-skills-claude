import React from 'react';
import { clsx } from 'clsx';

interface SidebarProps {
  children: React.ReactNode;
  open: boolean;
  className?: string;
}

export function Sidebar({ children, open, className }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'flex flex-col h-full bg-white border-r border-gray-200 transition-all duration-200 overflow-hidden',
        open ? 'w-64' : 'w-0',
        className,
      )}
    >
      <div className="w-64 h-full flex flex-col overflow-y-auto scrollbar-thin">
        {children}
      </div>
    </aside>
  );
}

export function SidebarSection({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between px-3 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

interface SidebarItemProps {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  indent?: number;
  onClick?: () => void;
  suffix?: React.ReactNode;
}

export function SidebarItem({
  label,
  icon,
  active = false,
  indent = 0,
  onClick,
  suffix,
}: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md py-1.5 text-sm transition-colors text-left',
        active
          ? 'bg-primary-50 text-primary-700 font-medium'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
      )}
      style={{ paddingLeft: `${(indent + 1) * 12}px`, paddingRight: '8px' }}
    >
      {icon && <span className="shrink-0 h-4 w-4">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {suffix && <span className="shrink-0">{suffix}</span>}
    </button>
  );
}
