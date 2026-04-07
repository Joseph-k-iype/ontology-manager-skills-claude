import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, MoreVertical, Trash2, ExternalLink } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Dropdown } from '@/components/ui/dropdown';
import { useDeleteOntology } from '@/hooks/use-ontologies';
import type { Ontology } from '@/types';

interface OntologyListProps {
  ontologies: Ontology[];
  spaceId: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function OntologyList({ ontologies, spaceId }: OntologyListProps) {
  const navigate = useNavigate();
  const deleteOntology = useDeleteOntology(spaceId);

  if (ontologies.length === 0) {
    return (
      <div className="text-center py-12">
        <BookOpen className="h-8 w-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">No ontologies in this folder.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {ontologies.map((ont, idx) => (
        <motion.div
          key={ont.id}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: idx * 0.04, duration: 0.2 }}
        >
          <Card
            interactive
            onClick={() => navigate(`/spaces/${spaceId}/ontology/${ont.id}`)}
            className="group"
          >
            <CardBody className="py-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
                  <BookOpen className="h-4 w-4 text-primary-600" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate text-sm">
                      {ont.name}
                    </span>
                    <StatusBadge status={ont.status} />
                    <span className="text-xs text-gray-400 font-mono">v{ont.version}</span>
                  </div>
                  {ont.description && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">{ont.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400 hidden sm:block">
                    {formatDate(ont.updated_at)}
                  </span>

                  <Dropdown
                    trigger={
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="Ontology actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    }
                    items={[
                      {
                        label: 'Open in Canvas',
                        icon: <ExternalLink className="h-4 w-4" />,
                        onClick: () => navigate(`/spaces/${spaceId}/ontology/${ont.id}`),
                      },
                      {
                        label: 'Explore (G6)',
                        icon: <ExternalLink className="h-4 w-4" />,
                        onClick: () =>
                          navigate(`/spaces/${spaceId}/ontology/${ont.id}/explore`),
                      },
                      {
                        label: 'Delete',
                        icon: <Trash2 className="h-4 w-4" />,
                        onClick: () => {
                          if (confirm(`Delete ontology "${ont.name}"?`)) {
                            deleteOntology.mutate(ont.id);
                          }
                        },
                        danger: true,
                      },
                    ]}
                  />
                </div>
              </div>
            </CardBody>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
