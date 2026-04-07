import React from 'react';
import { motion } from 'framer-motion';
import SpaceCard from './SpaceCard';
import type { Space } from '@/types';
import { LayoutGrid } from 'lucide-react';

interface SpaceListProps {
  spaces: Space[];
}

export default function SpaceList({ spaces }: SpaceListProps) {
  if (spaces.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-24 gap-3 text-center"
      >
        <div className="h-14 w-14 rounded-2xl bg-gray-100 flex items-center justify-center">
          <LayoutGrid className="h-6 w-6 text-gray-400" />
        </div>
        <div>
          <p className="font-medium text-gray-700">No spaces yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Create your first space to start building ontologies.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {spaces.map((space, idx) => (
        <SpaceCard key={space.id} space={space} index={idx} />
      ))}
    </div>
  );
}
