import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutGrid, GitBranch, Shield, Search, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpaces } from '@/hooks/use-spaces';

const FEATURES = [
  {
    icon: <LayoutGrid className="h-5 w-5 text-primary-600" />,
    title: 'Visual Ontology Authoring',
    description: 'Drag-and-drop object types, properties, and relationships on the React Flow canvas.',
  },
  {
    icon: <GitBranch className="h-5 w-5 text-emerald-600" />,
    title: 'Git-backed Versioning',
    description: 'Every change is committed to a Git worktree. Branch, diff, and merge ontology versions.',
  },
  {
    icon: <Shield className="h-5 w-5 text-amber-600" />,
    title: 'OPA Policy Enforcement',
    description: 'Fine-grained RBAC and ABAC policies. Every write goes through Open Policy Agent.',
  },
  {
    icon: <Search className="h-5 w-5 text-cyan-600" />,
    title: 'Hybrid Semantic Search',
    description: 'BM25 + kNN + RRF fusion search powered by Elasticsearch 8.17.',
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const { data: spaces } = useSpaces();

  return (
    <div className="min-h-full">
      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="inline-flex items-center gap-2 bg-primary-50 text-primary-700 text-xs font-semibold rounded-full px-3 py-1 mb-6 border border-primary-100">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse" />
              Enterprise Ontology Manager
            </div>

            <h1 className="text-4xl font-bold text-gray-900 leading-tight mb-4">
              Define, version, and govern
              <br />
              <span className="text-primary-600">semantic ontologies</span> at scale
            </h1>

            <p className="text-lg text-gray-500 max-w-2xl mb-8">
              Build rich knowledge graphs backed by FalkorDB, searchable via Elasticsearch,
              and governed by Open Policy Agent — all in a single collaborative workspace.
            </p>

            <div className="flex items-center gap-3">
              <Button
                size="lg"
                onClick={() => navigate('/spaces')}
                icon={<LayoutGrid className="h-5 w-5" />}
              >
                Browse Spaces
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => navigate('/spaces')}
                icon={<ArrowRight className="h-5 w-5" />}
              >
                {spaces?.length
                  ? `${spaces.length} space${spaces.length !== 1 ? 's' : ''} available`
                  : 'Get started'}
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Features grid */}
      <div className="max-w-5xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Platform capabilities</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((feat, idx) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + idx * 0.06, duration: 0.25 }}
                className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm"
              >
                <div className="h-9 w-9 rounded-lg bg-gray-50 flex items-center justify-center mb-3 border border-gray-100">
                  {feat.icon}
                </div>
                <h3 className="font-semibold text-gray-900 text-sm mb-1">{feat.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{feat.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Recent spaces preview */}
        {spaces && spaces.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-10"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Recent Spaces</h2>
              <button
                onClick={() => navigate('/spaces')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {spaces.slice(0, 5).map((space) => (
                <button
                  key={space.id}
                  onClick={() => navigate(`/spaces/${space.id}`)}
                  className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-3 text-left hover:border-primary-300 hover:shadow-sm transition-all"
                >
                  <div className="h-8 w-8 rounded-lg bg-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {space.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{space.name}</p>
                    {space.description && (
                      <p className="text-xs text-gray-500 truncate">{space.description}</p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
