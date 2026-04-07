import React, { useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Plus,
  GitBranch,
  Download,
  X,
  Compass,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import OntologyCanvas from '@/components/canvas/OntologyCanvas';
import { useOntology, usePublishOntology, useExportOntology } from '@/hooks/use-ontologies';
import { useCanvasStore } from '@/stores/canvas-store';
import { useCreateObjectType, useCreateProperty } from '@/hooks/use-canvas';
import { propertiesApi } from '@/api/properties';
import { useQuery } from '@tanstack/react-query';
import type { PropertyDataType, Cardinality } from '@/types';

const DATA_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'DateTime' },
  { value: 'uri', label: 'URI' },
];

/** Right-side panel: shows properties of selected node */
function PropertyPanel({
  nodeId,
  ontologyId,
  onClose,
}: {
  nodeId: string;
  ontologyId: string;
  onClose: () => void;
}) {
  const { nodes } = useCanvasStore();
  const node = nodes.find((n) => n.id === nodeId);
  const objectType = node?.data?.objectType;
  const [showAddProp, setShowAddProp] = useState(false);
  const [propForm, setPropForm] = useState({
    api_name: '',
    display_name: '',
    data_type: 'string' as PropertyDataType,
    required: false,
  });
  const createProperty = useCreateProperty(nodeId, ontologyId);

  const propertiesQuery = useQuery({
    queryKey: ['properties', nodeId],
    queryFn: () => propertiesApi.list(nodeId),
    enabled: Boolean(nodeId),
  });

  const handleAddProperty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propForm.api_name.trim() || !propForm.display_name.trim()) return;
    createProperty.mutate(
      {
        object_type_id: nodeId,
        api_name: propForm.api_name.trim(),
        display_name: propForm.display_name.trim(),
        data_type: propForm.data_type,
        required: propForm.required,
      },
      {
        onSuccess: () => {
          setPropForm({ api_name: '', display_name: '', data_type: 'string', required: false });
          setShowAddProp(false);
        },
      },
    );
  };

  if (!objectType) return null;

  return (
    <motion.aside
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="w-80 bg-canvas-node border-l border-canvas-nodeBorder flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-canvas-nodeBorder">
        <div className="min-w-0">
          <h3 className="font-semibold text-white text-sm truncate">
            {objectType.display_name}
          </h3>
          <p className="text-xs font-mono text-gray-500 mt-0.5">{objectType.api_name}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-canvas-grid transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Properties
          </span>
          <button
            onClick={() => setShowAddProp((v) => !v)}
            className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {/* Add property form */}
        <AnimatePresence>
          {showAddProp && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              onSubmit={handleAddProperty}
              className="mb-3 bg-canvas-grid rounded-lg p-3 flex flex-col gap-2 overflow-hidden"
            >
              <Input
                label="API name"
                placeholder="property_name"
                value={propForm.api_name}
                onChange={(e) => setPropForm((f) => ({ ...f, api_name: e.target.value }))}
                className="bg-canvas-node border-canvas-nodeBorder text-white placeholder:text-gray-600"
              />
              <Input
                label="Display name"
                placeholder="Property Name"
                value={propForm.display_name}
                onChange={(e) => setPropForm((f) => ({ ...f, display_name: e.target.value }))}
                className="bg-canvas-node border-canvas-nodeBorder text-white placeholder:text-gray-600"
              />
              <Select
                label="Data type"
                options={DATA_TYPE_OPTIONS}
                value={propForm.data_type}
                onChange={(e) =>
                  setPropForm((f) => ({ ...f, data_type: e.target.value as PropertyDataType }))
                }
                className="bg-canvas-node border-canvas-nodeBorder text-white"
              />
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={propForm.required}
                  onChange={(e) => setPropForm((f) => ({ ...f, required: e.target.checked }))}
                  className="rounded"
                />
                Required
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={createProperty.isPending}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAddProp(false)}
                  className="text-gray-400"
                >
                  Cancel
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Property list */}
        {propertiesQuery.isLoading ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 rounded bg-canvas-grid animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {(propertiesQuery.data ?? []).map((prop) => (
              <div
                key={prop.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-canvas-grid group transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-300 truncate">
                    {prop.api_name}
                    {prop.required && (
                      <span className="ml-1 text-red-400 text-[10px]">*</span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-600">{prop.data_type}</p>
                </div>
                {prop.api_name === objectType.primary_key && (
                  <span className="text-[9px] text-amber-400 font-mono font-medium shrink-0">
                    PK
                  </span>
                )}
              </div>
            ))}
            {(propertiesQuery.data ?? []).length === 0 && (
              <p className="text-xs text-gray-600 italic py-2">No properties yet</p>
            )}
          </div>
        )}
      </div>
    </motion.aside>
  );
}

/** Add Object Type modal/form overlay */
function AddObjectTypeOverlay({
  ontologyId,
  onClose,
}: {
  ontologyId: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    api_name: '',
    display_name: '',
    description: '',
    primary_key: 'id',
    is_skos_concept: false,
  });
  const createObjectType = useCreateObjectType(ontologyId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.api_name.trim() || !form.display_name.trim()) return;
    createObjectType.mutate(
      {
        ontology_id: ontologyId,
        api_name: form.api_name.trim(),
        display_name: form.display_name.trim(),
        description: form.description.trim() || undefined,
        primary_key: form.primary_key.trim() || 'id',
        is_skos_concept: form.is_skos_concept,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="bg-canvas-node border border-canvas-nodeBorder rounded-xl p-6 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">New Object Type</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="API name"
            placeholder="trade_confirmation"
            value={form.api_name}
            onChange={(e) => setForm((f) => ({ ...f, api_name: e.target.value }))}
            hint="snake_case identifier"
            className="bg-canvas-grid border-canvas-nodeBorder text-white placeholder:text-gray-600"
          />
          <Input
            label="Display name"
            placeholder="Trade Confirmation"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            className="bg-canvas-grid border-canvas-nodeBorder text-white placeholder:text-gray-600"
          />
          <Input
            label="Primary key field"
            placeholder="id"
            value={form.primary_key}
            onChange={(e) => setForm((f) => ({ ...f, primary_key: e.target.value }))}
            className="bg-canvas-grid border-canvas-nodeBorder text-white placeholder:text-gray-600"
          />
          <Textarea
            label="Description"
            placeholder="Optional description…"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            className="bg-canvas-grid border-canvas-nodeBorder text-white placeholder:text-gray-600"
          />
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_skos_concept}
              onChange={(e) => setForm((f) => ({ ...f, is_skos_concept: e.target.checked }))}
              className="rounded"
            />
            SKOS Concept
          </label>

          <div className="flex gap-2 pt-2">
            <Button type="submit" loading={createObjectType.isPending}>
              Add to Canvas
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default function OntologyPage() {
  const { spaceId = '', ontologyId = '' } = useParams<{
    spaceId: string;
    ontologyId: string;
  }>();
  const navigate = useNavigate();

  const [showAddObject, setShowAddObject] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const ontologyQuery = useOntology(spaceId, ontologyId);
  const publishOntology = usePublishOntology(spaceId, ontologyId);
  const exportOntology = useExportOntology(spaceId, ontologyId);
  const { closePanel } = useCanvasStore();

  const handleNodeSelect = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  const ontology = ontologyQuery.data;

  return (
    <div className="flex flex-col h-screen bg-canvas-bg">
      {/* Top toolbar */}
      <header className="h-12 bg-canvas-node border-b border-canvas-nodeBorder flex items-center px-4 gap-3 shrink-0 z-10">
        {/* Back nav */}
        <Link
          to={`/spaces/${spaceId}`}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-200 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:block">Space</span>
        </Link>

        <div className="h-4 w-px bg-canvas-nodeBorder" />

        {/* Breadcrumb */}
        {ontology && (
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            <span className="text-white font-medium truncate">{ontology.name}</span>
            <span className="text-gray-600 font-mono text-xs">v{ontology.version}</span>
            <StatusBadge status={ontology.status} />
          </div>
        )}

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setShowAddObject(true)}
            className="text-gray-300 hover:text-white"
          >
            Add Object
          </Button>

          <Button
            size="sm"
            variant="ghost"
            icon={<Compass className="h-4 w-4" />}
            onClick={() =>
              navigate(`/spaces/${spaceId}/ontology/${ontologyId}/explore`)
            }
            className="text-gray-300 hover:text-white"
          >
            Explore
          </Button>

          <div className="h-4 w-px bg-canvas-nodeBorder" />

          <Button
            size="sm"
            variant="ghost"
            icon={<Download className="h-4 w-4" />}
            loading={exportOntology.isPending}
            onClick={() => exportOntology.mutate()}
            className="text-gray-300 hover:text-white"
          >
            Export
          </Button>

          <Button
            size="sm"
            icon={<GitBranch className="h-4 w-4" />}
            loading={publishOntology.isPending}
            onClick={() => publishOntology.mutate()}
            disabled={ontology?.status === 'PUBLISHED'}
          >
            {ontology?.status === 'PUBLISHED' ? 'Published' : 'Publish'}
          </Button>
        </div>
      </header>

      {/* Canvas + right panel */}
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 overflow-hidden">
          <OntologyCanvas
            ontologyId={ontologyId}
            onNodeSelect={handleNodeSelect}
          />
        </div>

        {/* Property panel */}
        <AnimatePresence>
          {selectedNodeId && (
            <PropertyPanel
              key={selectedNodeId}
              nodeId={selectedNodeId}
              ontologyId={ontologyId}
              onClose={() => {
                setSelectedNodeId(null);
                closePanel();
              }}
            />
          )}
        </AnimatePresence>

        {/* Add Object overlay */}
        <AnimatePresence>
          {showAddObject && (
            <AddObjectTypeOverlay
              ontologyId={ontologyId}
              onClose={() => setShowAddObject(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
