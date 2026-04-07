import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
}

export function Card({ children, className, onClick, interactive = false }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={twMerge(
        clsx(
          'bg-white rounded-xl border border-gray-200 shadow-sm',
          interactive &&
            'cursor-pointer hover:border-primary-300 hover:shadow-md transition-all duration-200',
          className,
        ),
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('px-5 pt-5 pb-4', className)}>{children}</div>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('px-5 pb-5', className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('px-5 py-3 border-t border-gray-100', className)}>
      {children}
    </div>
  );
}
