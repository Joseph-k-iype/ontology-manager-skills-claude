import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Trash2, Edit2, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardBody, CardFooter } from '@/components/ui/card';
import { VisibilityBadge } from '@/components/ui/badge';
import { Dropdown } from '@/components/ui/dropdown';
import { useDeleteSpace } from '@/hooks/use-spaces';
import type { Space } from '@/types';

interface SpaceCardProps {
  space: Space;
  index: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const PALETTE = [
  'bg-indigo-500',
  'bg-violet-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-pink-500',
];

export default function SpaceCard({ space, index }: SpaceCardProps) {
  const navigate = useNavigate();
  const deleteSpace = useDeleteSpace();
  const color = PALETTE[index % PALETTE.length];

  const handleOpen = () => {
    navigate(`/spaces/${space.id}`);
  };

  const dropdownItems = [
    {
      label: 'Open',
      icon: <ArrowRight className="h-4 w-4" />,
      onClick: handleOpen,
    },
    {
      label: 'Edit',
      icon: <Edit2 className="h-4 w-4" />,
      onClick: () => {/* TODO: open edit modal */},
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => {
        if (confirm(`Delete space "${space.name}"? This cannot be undone.`)) {
          deleteSpace.mutate(space.id);
        }
      },
      danger: true,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05, ease: 'easeOut' }}
    >
      <Card
        interactive
        onClick={handleOpen}
        className="group h-full"
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            {/* Avatar */}
            <div
              className={`h-10 w-10 rounded-lg ${color} flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm`}
            >
              {initials(space.name)}
            </div>

            {/* Actions menu */}
            <Dropdown
              trigger={
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Space actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              }
              items={dropdownItems}
            />
          </div>

          <div className="mt-3">
            <h3 className="font-semibold text-gray-900 truncate leading-tight">
              {space.name}
            </h3>
            {space.description && (
              <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                {space.description}
              </p>
            )}
          </div>
        </CardHeader>

        <CardFooter className="flex items-center justify-between">
          <VisibilityBadge visibility={space.visibility} />
          <span className="text-xs text-gray-400">{formatDate(space.updated_at)}</span>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
