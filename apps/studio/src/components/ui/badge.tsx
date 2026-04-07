import React from 'react';
import { clsx } from 'clsx';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'purple';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-600',
  primary: 'bg-primary-100 text-primary-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Status badge for OntologyStatus */
export function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    DRAFT: 'warning',
    PUBLISHED: 'success',
    DEPRECATED: 'danger',
  };
  return <Badge variant={variantMap[status] ?? 'default'}>{status}</Badge>;
}

/** Visibility badge for SpaceVisibility */
export function VisibilityBadge({ visibility }: { visibility: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    PUBLIC: 'success',
    PRIVATE: 'default',
    SHARED: 'primary',
  };
  return <Badge variant={variantMap[visibility] ?? 'default'}>{visibility}</Badge>;
}
