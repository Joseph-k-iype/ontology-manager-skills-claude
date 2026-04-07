# Frontend Specification

> React 18 + TypeScript implementation guide.
> **Two graph renderers with a strict division of responsibility:**
> - **React Flow** — authoring canvas (SVG+HTML, React-native, loads eagerly)
> - **AntV G6** — exploration graph (Canvas, layout algorithms, lazy-loaded)
> - **`3d-force-graph`** — Phase 3 galaxy view (Three.js/WebGL, lazy-loaded)
>
> Read DATA_MODELS.md for all TypeScript interfaces.

---

## Project Structure

```
apps/studio/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes.tsx
│   │
│   ├── api/
│   │   ├── client.ts
│   │   ├── spaces.ts
│   │   ├── objects.ts
│   │   ├── branches.ts
│   │   ├── actions.ts
│   │   ├── search.ts
│   │   └── health.ts
│   │
│   ├── stores/
│   │   ├── canvas-store.ts      # React Flow authoring state
│   │   ├── explore-store.ts     # AntV G6 exploration state
│   │   └── auth-store.ts
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Sidebar.tsx      # Nav: Canvas | Explore | Search | Branches | Health
│   │   │   └── Topbar.tsx
│   │   │
│   │   ├── canvas/              # ── REACT FLOW — authoring ──────────────────
│   │   │   ├── OntologyCanvas.tsx      # Root React Flow component
│   │   │   ├── ObjectTypeNode.tsx      # Custom node — opens editor on click
│   │   │   ├── LinkTypeEdge.tsx        # Custom edge — cardinality badge
│   │   │   ├── InterfaceNode.tsx       # Interface node (purple, dashed border)
│   │   │   ├── CanvasToolbar.tsx       # View mode, zoom, diff controls
│   │   │   ├── DiffOverlay.tsx         # Branch diff colour layer
│   │   │   └── CreateNodePopover.tsx   # Right-click context menu
│   │   │
│   │   ├── explore/             # ── ANTV G6 — exploration ───────────────────
│   │   │   ├── OntologyExplorer.tsx    # Root G6 component (imperative ref)
│   │   │   ├── ExplorerToolbar.tsx     # Layout picker, mode switcher
│   │   │   ├── BlastRadiusView.tsx     # Radial layout from a pivot node
│   │   │   ├── DependencyTree.tsx      # Dagre tree from selected type
│   │   │   ├── PathFinderView.tsx      # Shortest-path highlight
│   │   │   └── ExploreNodePanel.tsx    # Read-only side panel on node click
│   │   │
│   │   ├── galaxy/              # ── 3D-FORCE-GRAPH — Phase 3 ─────────────────
│   │   │   └── MetaGraphGalaxy.tsx     # 3D WebGL, all Spaces
│   │   │
│   │   ├── editors/
│   │   │   ├── ObjectTypeEditor.tsx
│   │   │   ├── PropertyEditor.tsx
│   │   │   ├── ActionTypeEditor.tsx
│   │   │   ├── LinkTypeEditor.tsx
│   │   │   ├── InterfaceEditor.tsx
│   │   │   └── DatasourceEditor.tsx
│   │   │
│   │   ├── branches/
│   │   │   ├── BranchPanel.tsx
│   │   │   ├── ProposalPanel.tsx
│   │   │   ├── DiffViewer.tsx
│   │   │   └── ApprovalGates.tsx
│   │   │
│   │   ├── search/
│   │   │   ├── SearchBar.tsx
│   │   │   ├── SearchResults.tsx
│   │   │   └── ObjectDetailPanel.tsx
│   │   │
│   │   ├── health/
│   │   │   ├── HealthDashboard.tsx
│   │   │   ├── VolumeCharts.tsx
│   │   │   └── AlertFeed.tsx
│   │   │
│   │   ├── shared/
│   │   │   └── SharedPropertyRegistry.tsx
│   │   │
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Badge.tsx
│   │       ├── StatusBadge.tsx
│   │       ├── ConfirmDialog.tsx
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── MonacoEditor.tsx
│   │
│   ├── pages/
│   │   ├── SpaceListPage.tsx
│   │   ├── CanvasPage.tsx           # React Flow (eager)
│   │   ├── ExploreGraphPage.tsx     # AntV G6 (lazy)
│   │   ├── GalaxyViewPage.tsx       # 3d-force-graph (lazy, Phase 3)
│   │   ├── ObjectTypePage.tsx
│   │   ├── SearchPage.tsx
│   │   ├── BranchesPage.tsx
│   │   ├── HealthPage.tsx
│   │   └── SettingsPage.tsx
│   │
│   ├── types/
│   │   └── index.ts
│   │
│   └── utils/
│       ├── ontology-to-flow.ts      # ObjectType[] → React Flow nodes/edges
│       ├── ontology-to-g6.ts        # ObjectType[] → G6 NodeData/EdgeData
│       ├── g6-layouts.ts            # G6 layout config presets
│       ├── color-scheme.ts          # Status, sensitivity, domain colours
│       └── format.ts
│
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Routing — Lazy Loading Strategy

G6 and 3d-force-graph are heavy. They must be lazy-loaded — never imported
in files that are part of the initial bundle.

```tsx
// src/routes.tsx
import { createBrowserRouter } from 'react-router-dom';
import { lazy, Suspense }      from 'react';
import AppShell                from './components/layout/AppShell';
import LoadingSpinner          from './components/ui/LoadingSpinner';

// ── Eager: initial bundle ────────────────────────────────────────────────────
import SpaceListPage  from './pages/SpaceListPage';
import CanvasPage     from './pages/CanvasPage';
import ObjectTypePage from './pages/ObjectTypePage';
import SearchPage     from './pages/SearchPage';
import BranchesPage   from './pages/BranchesPage';
import HealthPage     from './pages/HealthPage';
import SettingsPage   from './pages/SettingsPage';

// ── Lazy: loaded on first route visit, cached thereafter ─────────────────────
const ExploreGraphPage = lazy(() => import('./pages/ExploreGraphPage')); // G6
const GalaxyViewPage   = lazy(() => import('./pages/GalaxyViewPage'));   // Three.js Phase 3

const LazyWrapper = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<LoadingSpinner message="Loading graph engine..." />}>
    {children}
  </Suspense>
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true,                                   element: <SpaceListPage /> },
      { path: 'spaces/:spaceId',                       element: <CanvasPage /> },
      { path: 'spaces/:spaceId/explore',
        element: <LazyWrapper><ExploreGraphPage /></LazyWrapper> },
      { path: 'spaces/:spaceId/galaxy',
        element: <LazyWrapper><GalaxyViewPage /></LazyWrapper> },
      { path: 'spaces/:spaceId/types/:apiName',        element: <ObjectTypePage /> },
      { path: 'spaces/:spaceId/search',                element: <SearchPage /> },
      { path: 'spaces/:spaceId/branches',              element: <BranchesPage /> },
      { path: 'spaces/:spaceId/health',                element: <HealthPage /> },
      { path: 'spaces/:spaceId/settings',              element: <SettingsPage /> },
    ],
  },
]);
```

---

## Stores

### canvas-store.ts (React Flow — Authoring)

```typescript
// src/stores/canvas-store.ts
import { create } from 'zustand';
import type { Viewport } from 'reactflow';
import type { OntologyNode, OntologyEdge } from '../types';

export type CanvasViewMode = 'conceptual' | 'logical' | 'physical';

interface CanvasState {
  nodes:        OntologyNode[];
  edges:        OntologyEdge[];
  viewport:     Viewport;
  viewMode:     CanvasViewMode;
  selectedNode: string | null;
  diffMode:     boolean;
  diffBranch:   string | null;
  isDirty:      boolean;            // unsaved YAML edits on current branch

  setNodes:     (nodes: OntologyNode[]) => void;
  setEdges:     (edges: OntologyEdge[]) => void;
  setViewport:  (vp: Viewport) => void;
  setViewMode:  (mode: CanvasViewMode) => void;
  selectNode:   (id: string | null) => void;
  toggleDiff:   (branch: string | null) => void;
  setDirty:     (dirty: boolean) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  nodes:        [],
  edges:        [],
  viewport:     { x: 0, y: 0, zoom: 1 },
  viewMode:     'logical',
  selectedNode: null,
  diffMode:     false,
  diffBranch:   null,
  isDirty:      false,

  setNodes:    (nodes)    => set({ nodes }),
  setEdges:    (edges)    => set({ edges }),
  setViewport: (viewport) => set({ viewport }),
  setViewMode: (viewMode) => set({ viewMode }),
  selectNode:  (id)       => set({ selectedNode: id }),
  toggleDiff:  (branch)   => set({ diffMode: !!branch, diffBranch: branch }),
  setDirty:    (dirty)    => set({ isDirty: dirty }),
}));
```

### explore-store.ts (AntV G6 — Exploration)

```typescript
// src/stores/explore-store.ts
import { create } from 'zustand';
import type { G6LayoutType, G6GraphData } from '../types';

export type ExploreMode =
  | 'overview'
  | 'blast-radius'
  | 'dependency-tree'
  | 'path-finder';

interface ExploreState {
  graphData:    G6GraphData | null;
  layoutType:   G6LayoutType;
  mode:         ExploreMode;
  pivotNodeId:  string | null;    // focus node for blast-radius / dependency-tree
  pathSource:   string | null;
  pathTarget:   string | null;
  selectedNode: string | null;

  setGraphData:  (data: G6GraphData) => void;
  setLayout:     (layout: G6LayoutType) => void;
  setMode:       (mode: ExploreMode, pivotId?: string) => void;
  setPathNodes:  (source: string, target: string) => void;
  selectNode:    (id: string | null) => void;
  resetView:     () => void;
}

export const useExploreStore = create<ExploreState>((set) => ({
  graphData:    null,
  layoutType:   'force',
  mode:         'overview',
  pivotNodeId:  null,
  pathSource:   null,
  pathTarget:   null,
  selectedNode: null,

  setGraphData:  (data)           => set({ graphData: data }),
  setLayout:     (layoutType)     => set({ layoutType }),
  setMode:       (mode, pivotId)  => set({ mode, pivotNodeId: pivotId ?? null }),
  setPathNodes:  (source, target) => set({ pathSource: source, pathTarget: target }),
  selectNode:    (id)             => set({ selectedNode: id }),
  resetView:     ()               => set({
    mode: 'overview', pivotNodeId: null, pathSource: null, pathTarget: null,
  }),
}));
```

### auth-store.ts

```typescript
// src/stores/auth-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token:     string | null;
  caller:    { user_id: string; org_id: string; roles: string[]; email: string } | null;
  setToken:  (token: string) => void;
  setCaller: (caller: AuthState['caller']) => void;
  logout:    () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token:     null,
      caller:    null,
      setToken:  (token)  => set({ token }),
      setCaller: (caller) => set({ caller }),
      logout:    ()       => set({ token: null, caller: null }),
    }),
    { name: 'eom-auth' }
  )
);
```

---

## React Flow — Authoring Canvas

### OntologyCanvas.tsx

```tsx
// src/components/canvas/OntologyCanvas.tsx
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  Connection, Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useEffect, useCallback } from 'react';
import { useCanvasStore }   from '../../stores/canvas-store';
import ObjectTypeNode       from './ObjectTypeNode';
import LinkTypeEdge         from './LinkTypeEdge';
import InterfaceNode        from './InterfaceNode';
import CanvasToolbar        from './CanvasToolbar';
import ObjectTypeEditor     from '../editors/ObjectTypeEditor';
import { ontologyToFlow }   from '../../utils/ontology-to-flow';
import type { ObjectType, LinkType, Interface } from '../../types';

const nodeTypes = { objectType: ObjectTypeNode, interface: InterfaceNode };
const edgeTypes = { linkType:   LinkTypeEdge };

interface Props {
  spaceId:     string;
  branch:      string;
  objectTypes: ObjectType[];
  linkTypes:   LinkType[];
  interfaces:  Interface[];
  readOnly?:   boolean;
  onSaveNode:  (updated: Partial<ObjectType>) => void;
}

export default function OntologyCanvas({
  spaceId, branch, objectTypes, linkTypes, interfaces, readOnly, onSaveNode,
}: Props) {
  const { viewMode, selectedNode, diffBranch, selectNode, setDirty } = useCanvasStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const { nodes: n, edges: e } = ontologyToFlow(
      objectTypes, linkTypes, interfaces, viewMode, diffBranch
    );
    setNodes(n);
    setEdges(e);
  }, [objectTypes, linkTypes, interfaces, viewMode, diffBranch]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => selectNode(node.id),
    [selectNode]
  );

  const onConnect = useCallback((connection: Connection) => {
    // Opens "Create Link Type" dialog pre-filled with source/target
    console.log('Draw link:', connection);
  }, []);

  const selectedOT = objectTypes.find(ot => ot.api_name === selectedNode);

  return (
    <div className="w-full h-full flex">
      <div className="flex-1 relative">
        <CanvasToolbar spaceId={spaceId} branch={branch} readOnly={readOnly} />
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onConnect={readOnly ? undefined : onConnect}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          fitView minZoom={0.05} maxZoom={2}
          className="bg-gray-50 dark:bg-gray-900"
        >
          <Background gap={24} color="#e5e7eb" />
          <Controls />
          <MiniMap zoomable pannable
            nodeColor={(n) => {
              const status = (n.data as ObjectType).status;
              return status === 'PUBLISHED'  ? '#22c55e' :
                     status === 'DEPRECATED' ? '#f59e0b' : '#94a3b8';
            }}
          />
          {diffBranch && (
            <Panel position="top-right"
                   className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 text-xs space-y-1">
              <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">
                Diff vs {diffBranch}
              </p>
              {[
                ['bg-green-400', 'Added'],
                ['bg-amber-400', 'Changed'],
                ['bg-red-400',   'Removed'],
              ].map(([cls, label]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className={`w-3 h-3 rounded ${cls}`} />
                  <span className="text-gray-500">{label}</span>
                </div>
              ))}
            </Panel>
          )}
        </ReactFlow>
      </div>

      {selectedOT && (
        <div className="w-[480px] border-l border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-hidden">
          <ObjectTypeEditor
            spaceId={spaceId}
            objectType={selectedOT}
            readOnly={readOnly}
            onSave={(u) => { onSaveNode(u); setDirty(true); }}
            onClose={() => selectNode(null)}
          />
        </div>
      )}
    </div>
  );
}
```

### ObjectTypeNode.tsx

```tsx
// src/components/canvas/ObjectTypeNode.tsx
import { Handle, Position, NodeProps } from 'reactflow';
import type { ObjectType } from '../../types';
import StatusBadge from '../ui/StatusBadge';

const SENSITIVITY_BORDER: Record<string, string> = {
  PUBLIC:       'border-green-400',
  INTERNAL:     'border-blue-400',
  CONFIDENTIAL: 'border-amber-400',
  RESTRICTED:   'border-red-500',
};

export default function ObjectTypeNode({ data, selected }: NodeProps<ObjectType & { _diffStatus?: string }>) {
  const diffRing = data._diffStatus === 'added'   ? 'ring-2 ring-green-500'  :
                   data._diffStatus === 'changed'  ? 'ring-2 ring-amber-400' :
                   data._diffStatus === 'removed'  ? 'ring-2 ring-red-500 opacity-60' : '';
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-md border-2 min-w-[180px] max-w-[240px]
                     transition-shadow hover:shadow-xl
                     ${SENSITIVITY_BORDER[data.sensitivity_level] ?? 'border-gray-300'}
                     ${selected ? 'ring-2 ring-indigo-500' : ''} ${diffRing}`}>
      <Handle type="target" position={Position.Left}  className="!w-2 !h-2 !bg-gray-400" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-400" />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="text-[10px] font-mono text-gray-400 truncate">{data.api_name}</span>
          <StatusBadge status={data.status} />
        </div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
          {data.display_name}
        </p>
        {data.domain && <p className="text-[11px] text-gray-400 mt-0.5">{data.domain}</p>}
      </div>
      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-2
                      flex gap-3 text-[11px] text-gray-400">
        <span>{data.properties.length} props</span>
        <span>{data.action_types.length} actions</span>
        {data.datasource      && <span title="Has datasource">📡</span>}
        {data.enable_embeddings && <span title="Embeddings">🔮</span>}
      </div>
    </div>
  );
}
```

### LinkTypeEdge.tsx

```tsx
// src/components/canvas/LinkTypeEdge.tsx
import { EdgeProps, getBezierPath, EdgeLabelRenderer, BaseEdge } from 'reactflow';
import type { LinkType } from '../../types';

const CARD: Record<string, string> = {
  ONE_TO_ONE: '1:1', ONE_TO_MANY: '1:N', MANY_TO_ONE: 'N:1', MANY_TO_MANY: 'N:M',
};

export default function LinkTypeEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected,
}: EdgeProps<LinkType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{
        stroke:          selected ? '#6366f1' : data?.is_temporally_bounded ? '#f59e0b' : '#94a3b8',
        strokeWidth:     selected ? 2 : 1.5,
        strokeDasharray: data?.is_temporally_bounded ? '6 3' : undefined,
      }} />
      <EdgeLabelRenderer>
        <div style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
             className="absolute pointer-events-none">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600
                          rounded-full px-2 py-0.5 text-[10px] text-gray-500 shadow-sm flex gap-1">
            <span>{data?.display_name}</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">{CARD[data?.cardinality ?? 'ONE_TO_MANY']}</span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

---

## AntV G6 — Exploration Graph

> G6 5.x is imperative — the graph instance is managed via a `useRef`, never
> stored in Zustand or React state. All graph mutation goes through
> `graphRef.current`. Do not pass G6 graph instances as props.

### OntologyExplorer.tsx

```tsx
// src/components/explore/OntologyExplorer.tsx
import { useEffect, useRef } from 'react';
import Graph from '@antv/g6';
import { useExploreStore }  from '../../stores/explore-store';
import { ontologyToG6 }     from '../../utils/ontology-to-g6';
import { buildG6Config }    from '../../utils/g6-layouts';
import ExplorerToolbar      from './ExplorerToolbar';
import ExploreNodePanel     from './ExploreNodePanel';
import type { ObjectType, LinkType } from '../../types';

interface Props {
  spaceId:     string;
  objectTypes: ObjectType[];
  linkTypes:   LinkType[];
}

export default function OntologyExplorer({ spaceId, objectTypes, linkTypes }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef     = useRef<InstanceType<typeof Graph> | null>(null);
  const { layoutType, mode, pivotNodeId, selectedNode, setGraphData, selectNode } =
    useExploreStore();

  // Build + store G6 data
  useEffect(() => {
    setGraphData(ontologyToG6(objectTypes, linkTypes));
  }, [objectTypes, linkTypes]);

  // Initialise G6 once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const { layout, animation } = buildG6Config('force');

    graphRef.current = new Graph({
      container: containerRef.current,
      width:     containerRef.current.clientWidth,
      height:    containerRef.current.clientHeight,
      layout,
      animation,
      node: {
        style: (model: any) => ({
          fill:          statusFill(model.data.status),
          stroke:        sensitivityStroke(model.data.sensitivity),
          lineWidth:     2,
          radius:        8,
          labelText:     model.data.label,
          labelFontSize: 11,
          labelMaxWidth: 160,
        }),
      },
      edge: {
        style: (model: any) => ({
          stroke:      model.data.isTemporal ? '#f59e0b' : '#cbd5e1',
          lineWidth:   1.5,
          endArrow:    true,
          lineDash:    model.data.isTemporal ? [4, 2] : undefined,
          labelText:   model.data.label,
          labelFontSize: 10,
          labelFill:   '#94a3b8',
        }),
      },
      combo: {
        style: { fill: '#f8fafc', stroke: '#e2e8f0', lineWidth: 1, radius: 12 },
      },
      behaviors: [
        'drag-canvas', 'zoom-canvas', 'drag-node',
        { type: 'click-select', multiple: false },
        { type: 'hover-activate', activeState: 'active' },
        { type: 'lasso-select' },
        { type: 'fisheye', trigger: 'shift' },
      ],
      plugins: [
        { type: 'minimap', size: [160, 100], position: 'bottom-right' },
        { type: 'legend',  nodeField: 'status',  position: 'top-left' },
        {
          type: 'tooltip',
          getContent: (_: any, items: any[]) => {
            const d = items[0]?.data;
            return d ? `<b>${d.label}</b><br/><code style="font-size:10px">${d.id}</code>` : '';
          },
        },
      ],
    });

    graphRef.current.on('node:click', (evt: any) => selectNode(evt.itemId ?? null));
    graphRef.current.on('canvas:click', () => selectNode(null));

    return () => { graphRef.current?.destroy(); graphRef.current = null; };
  }, []);

  // Sync data to G6 instance
  const { graphData } = useExploreStore();
  useEffect(() => {
    if (!graphRef.current || !graphData) return;
    graphRef.current.setData(graphData as any);
    graphRef.current.render();
  }, [graphData]);

  // Change layout algorithm
  useEffect(() => {
    if (!graphRef.current) return;
    const { layout } = buildG6Config(layoutType);
    graphRef.current.updateLayout(layout as any);
  }, [layoutType]);

  // Blast-radius mode — radial layout + dim non-neighbours
  useEffect(() => {
    const g = graphRef.current;
    if (!g || mode !== 'blast-radius' || !pivotNodeId) return;
    const neighborIds: string[] = g.getNeighborNodeIDs(pivotNodeId);
    const relevant = new Set([pivotNodeId, ...neighborIds]);
    g.getAllNodesData().forEach((n: any) => {
      g.setItemState(n.id, 'inactive', !relevant.has(n.id));
    });
    g.updateLayout({ type: 'radial', focusNode: pivotNodeId, unitRadius: 120 } as any);
  }, [mode, pivotNodeId]);

  // Overview mode — clear all states
  useEffect(() => {
    const g = graphRef.current;
    if (!g || mode !== 'overview') return;
    g.getAllNodesData().forEach((n: any) => g.clearItemState(n.id));
    const { layout } = buildG6Config(layoutType);
    g.updateLayout(layout as any);
  }, [mode]);

  const selectedOT = objectTypes.find(ot => ot.api_name === selectedNode);

  return (
    <div className="w-full h-full flex flex-col">
      <ExplorerToolbar spaceId={spaceId} />
      <div className="flex flex-1 overflow-hidden">
        <div ref={containerRef} className="flex-1 bg-slate-950" />
        {selectedOT && (
          <div className="w-[400px] border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
            <ExploreNodePanel objectType={selectedOT} />
          </div>
        )}
      </div>
    </div>
  );
}

function statusFill(status: string) {
  return status === 'PUBLISHED' ? '#dcfce7' : status === 'DEPRECATED' ? '#fef9c3' : '#f1f5f9';
}
function sensitivityStroke(sensitivity: string) {
  return sensitivity === 'RESTRICTED' ? '#ef4444' :
         sensitivity === 'CONFIDENTIAL' ? '#f59e0b' :
         sensitivity === 'INTERNAL'     ? '#3b82f6' : '#22c55e';
}
```

### ExploreNodePanel.tsx

```tsx
// src/components/explore/ExploreNodePanel.tsx
import type { ObjectType } from '../../types';
import { useExploreStore }  from '../../stores/explore-store';

export default function ExploreNodePanel({ objectType }: { objectType: ObjectType }) {
  const { setMode, selectNode } = useExploreStore();

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-mono text-gray-400">{objectType.api_name}</p>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            {objectType.display_name}
          </h3>
        </div>
        <button onClick={() => selectNode(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>
      <p className="text-sm text-gray-500">{objectType.description || 'No description.'}</p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode('blast-radius', objectType.api_name)}
          className="text-xs px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700
                     hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 font-medium"
        >💥 Blast Radius</button>
        <button
          onClick={() => setMode('dependency-tree', objectType.api_name)}
          className="text-xs px-3 py-2 rounded-lg bg-purple-50 text-purple-700
                     hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400 font-medium"
        >🌳 Dependency Tree</button>
      </div>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
          Properties ({objectType.properties.length})
        </p>
        <ul className="space-y-1">
          {objectType.properties.slice(0, 10).map(p => (
            <li key={p.api_name} className="flex justify-between text-xs">
              <span className="font-mono text-gray-600 dark:text-gray-300">{p.api_name}</span>
              <span className="text-gray-400">{p.base_type}</span>
            </li>
          ))}
          {objectType.properties.length > 10 && (
            <li className="text-xs text-gray-400 italic">
              +{objectType.properties.length - 10} more…
            </li>
          )}
        </ul>
      </section>

      {objectType.action_types.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Actions ({objectType.action_types.length})
          </p>
          <ul className="space-y-1">
            {objectType.action_types.map(at => (
              <li key={at.api_name} className="text-xs font-mono text-gray-600 dark:text-gray-300">
                {at.api_name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

### ExplorerToolbar.tsx

```tsx
// src/components/explore/ExplorerToolbar.tsx
import { useExploreStore } from '../../stores/explore-store';
import type { G6LayoutType } from '../../types';

const LAYOUTS: { id: G6LayoutType; label: string; icon: string }[] = [
  { id: 'force',    label: 'Force',      icon: '🔵' },
  { id: 'dagre',    label: 'Hierarchy',  icon: '🌲' },
  { id: 'radial',   label: 'Radial',     icon: '🎯' },
  { id: 'circular', label: 'Circular',   icon: '⭕' },
  { id: 'grid',     label: 'Grid',       icon: '▦'  },
];

const MODE_LABELS: Record<string, string> = {
  'blast-radius':    '💥 Blast Radius',
  'dependency-tree': '🌳 Dependency Tree',
  'path-finder':     '🔗 Path Finder',
};

export default function ExplorerToolbar({ spaceId }: { spaceId: string }) {
  const { layoutType, mode, setLayout, resetView } = useExploreStore();

  return (
    <div className="h-12 border-b border-gray-200 dark:border-gray-700 px-4
                    flex items-center gap-3 bg-white dark:bg-gray-900 flex-shrink-0">
      <span className="text-xs text-gray-400 font-medium">Layout:</span>
      {LAYOUTS.map(l => (
        <button key={l.id} onClick={() => setLayout(l.id)} title={l.label}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors
                  ${layoutType === l.id
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          {l.icon} {l.label}
        </button>
      ))}

      {mode !== 'overview' && (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700
                           dark:bg-amber-900/30 dark:text-amber-300 font-medium">
            {MODE_LABELS[mode]}
          </span>
          <button onClick={resetView}
                  className="text-xs text-gray-400 hover:text-gray-600 underline">
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## G6 Utilities

### g6-layouts.ts

```typescript
// src/utils/g6-layouts.ts
import type { G6LayoutType } from '../types';

const LAYOUT_CONFIGS: Record<G6LayoutType, object> = {
  force: {
    type:           'force2',
    preventOverlap: true,
    nodeStrength:   -400,
    edgeStrength:   0.6,
    linkDistance:   200,
    iterations:     300,
  },
  dagre: {
    type:    'dagre',
    rankdir: 'TB',
    nodesep: 40,
    ranksep: 80,
    align:   'UL',
  },
  radial: {
    type:           'radial',
    unitRadius:     120,
    preventOverlap: true,
    maxIteration:   200,
  },
  circular: {
    type:     'circular',
    radius:   300,
    ordering: 'topology',
  },
  grid: {
    type:   'grid',
    width:  1200,
    height: 800,
    sortBy: 'degree',
  },
};

export function buildG6Config(layoutType: G6LayoutType) {
  return {
    layout:    LAYOUT_CONFIGS[layoutType] ?? LAYOUT_CONFIGS['force'],
    animation: { duration: 500, easing: 'ease-out' },
  };
}
```

### ontology-to-g6.ts

```typescript
// src/utils/ontology-to-g6.ts
import type { ObjectType, LinkType, G6GraphData } from '../types';

export function ontologyToG6(objectTypes: ObjectType[], linkTypes: LinkType[]): G6GraphData {
  const nodes = objectTypes.map(ot => ({
    id:           ot.api_name,
    label:        ot.display_name,
    objectType:   ot,
    comboId:      ot.domain || 'Uncategorised',
    status:       ot.status,
    sensitivity:  ot.sensitivity_level,
    hasDataSource:!!ot.datasource,
  }));

  const nodeIds = new Set(nodes.map(n => n.id));

  const edges = linkTypes
    .filter(lt => nodeIds.has(lt.source_object_type) && nodeIds.has(lt.target_object_type))
    .map(lt => ({
      id:          `${lt.source_object_type}__${lt.api_name}__${lt.target_object_type}`,
      source:      lt.source_object_type,
      target:      lt.target_object_type,
      label:       lt.display_name,
      linkType:    lt,
      isTemporal:  lt.is_temporally_bounded,
      cardinality: lt.cardinality,
    }));

  const combos = [...new Set(objectTypes.map(ot => ot.domain || 'Uncategorised'))]
    .map(d => ({ id: d, label: d }));

  return { nodes, edges, combos };
}
```

### ontology-to-flow.ts

```typescript
// src/utils/ontology-to-flow.ts
import type { OntologyNode, OntologyEdge, ObjectType, LinkType, Interface } from '../types';
import type { CanvasViewMode } from '../stores/canvas-store';

export function ontologyToFlow(
  objectTypes: ObjectType[],
  linkTypes:   LinkType[],
  interfaces:  Interface[],
  viewMode:    CanvasViewMode,
  diffBranch:  string | null,
): { nodes: OntologyNode[]; edges: OntologyEdge[] } {
  const cols = Math.ceil(Math.sqrt(objectTypes.length + 1));

  const nodes: OntologyNode[] = objectTypes.map((ot, i) => ({
    id:       ot.api_name,
    type:     'objectType',
    data:     ot,
    position: { x: (i % cols) * 300, y: Math.floor(i / cols) * 180 },
  }));

  if (viewMode !== 'conceptual') {
    interfaces.forEach((iface, i) => {
      nodes.push({
        id:       `iface__${iface.api_name}`,
        type:     'interface',
        data:     iface,
        position: { x: -280, y: i * 140 },
      });
    });
  }

  const edges: OntologyEdge[] = linkTypes.map(lt => ({
    id:     `${lt.source_object_type}__${lt.api_name}__${lt.target_object_type}`,
    source: lt.source_object_type,
    target: lt.target_object_type,
    type:   'linkType',
    data:   lt,
    label:  lt.display_name,
  }));

  if (viewMode !== 'conceptual') {
    objectTypes.forEach(ot => {
      ot.interfaces.forEach(ifaceName => {
        edges.push({
          id:     `${ot.api_name}__implements__${ifaceName}`,
          source: ot.api_name,
          target: `iface__${ifaceName}`,
          type:   'linkType',
          data:   { api_name: 'implements', display_name: 'implements',
                    cardinality: 'ONE_TO_ONE', is_temporally_bounded: false } as any,
          label:  'implements',
        });
      });
    });
  }

  return { nodes, edges };
}
```

---

## Phase 3 — Galaxy View (3d-force-graph)

Only build this when total type count regularly exceeds ~300.
The import is inside the lazy chunk — it must never appear in an eager file.

```tsx
// src/components/galaxy/MetaGraphGalaxy.tsx
import ForceGraph3D from '3d-force-graph';
import { useRef, useEffect } from 'react';
import type { GalaxyNode, GalaxyLink } from '../../types';

const DOMAIN_COLORS: Record<string, string> = {
  Trade:    '#6366f1',
  Party:    '#22c55e',
  Risk:     '#ef4444',
  Reference:'#f59e0b',
  default:  '#94a3b8',
};

export default function MetaGraphGalaxy({ nodes, links }: { nodes: GalaxyNode[]; links: GalaxyLink[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const fgRef    = useRef<any>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    fgRef.current = ForceGraph3D()(mountRef.current)
      .graphData({ nodes, links })
      .nodeLabel((n: GalaxyNode) => `${n.name}\n${n.type}`)
      .nodeColor((n: GalaxyNode) => DOMAIN_COLORS[n.domain] ?? DOMAIN_COLORS.default)
      .nodeOpacity(0.9)
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .linkOpacity(0.25)
      .backgroundColor('#020617')
      .onNodeClick((node: GalaxyNode) => {
        const dist = 80;
        const r = Math.hypot((node as any).x, (node as any).y, (node as any).z);
        const ratio = 1 + dist / r;
        fgRef.current?.cameraPosition(
          { x: (node as any).x * ratio, y: (node as any).y * ratio, z: (node as any).z * ratio },
          node as any, 1200
        );
      });
    return () => fgRef.current?._destructor?.();
  }, []);

  useEffect(() => { fgRef.current?.graphData({ nodes, links }); }, [nodes, links]);

  return <div ref={mountRef} className="w-full h-full" />;
}
```

---

## API Client & TanStack Query Hooks

```typescript
// src/api/client.ts
import axios from 'axios';
import { useAuthStore } from '../stores/auth-store';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const detail = err.response?.data?.detail;
    return Promise.reject(new Error(
      typeof detail === 'string' ? detail : detail?.message ?? 'Unexpected error'
    ));
  }
);
```

```typescript
// src/api/objects.ts
import { useQuery }     from '@tanstack/react-query';
import { apiClient }    from './client';
import type { SearchResult } from '../types';

export const objectKeys = {
  list:   (sid: string, type: string, f: object) => ['objects', sid, type, f] as const,
  detail: (sid: string, type: string, id: string) => ['objects', sid, type, id] as const,
  search: (sid: string, q: string) => ['search', sid, q] as const,
};

export function useSemanticSearch(spaceId: string, query: string, k = 20) {
  return useQuery({
    queryKey: objectKeys.search(spaceId, query),
    queryFn:  async () => {
      const res = await apiClient.post<{ results: SearchResult[] }>(
        `/api/v1/spaces/${spaceId}/search`,
        { query, k, use_embeddings: true }
      );
      return res.data.results;
    },
    enabled:   query.length >= 2,
    staleTime: 10_000,
  });
}
```

---

## Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path  from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server:  {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Eager (downloaded with initial load)
          'reactflow': ['reactflow'],
          'monaco':    ['monaco-editor'],
          'charts':    ['recharts'],

          // Lazy (downloaded only when route is first visited)
          'g6':        ['@antv/g6'],
          'three':     ['3d-force-graph', 'three'],
        },
      },
    },
  },
});
```

---

## package.json

```json
{
  "name": "@eom/studio",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev":       "vite",
    "build":     "tsc && vite build",
    "test":      "vitest",
    "test:e2e":  "playwright test",
    "lint":      "eslint src --ext .ts,.tsx",
    "type-check":"tsc --noEmit"
  },
  "dependencies": {
    "react":                   "^18.3.0",
    "react-dom":               "^18.3.0",
    "react-router-dom":        "^6.26.0",

    "reactflow":               "^12.0.0",
    "@antv/g6":                "^5.0.0",
    "3d-force-graph":          "^1.73.0",

    "@tanstack/react-query":   "^5.51.0",
    "zustand":                 "^4.5.0",
    "axios":                   "^1.7.0",
    "monaco-editor":           "^0.45.0",
    "recharts":                "^2.12.0",
    "tailwindcss":             "^3.4.0",
    "use-debounce":            "^10.0.0",
    "lucide-react":            "^0.383.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react":    "^4.3.0",
    "vite":                    "^5.3.0",
    "typescript":              "^5.5.0",
    "vitest":                  "^2.0.0",
    "@playwright/test":        "^1.45.0",
    "@types/react":            "^18.3.0",
    "@types/react-dom":        "^18.3.0"
  }
}
```

---

## Bundle Size Reference

| Chunk | Library | Gzipped target | Load strategy |
|---|---|---|---|
| App shell | React + Router + Zustand + Axios | < 80 KB | Eager |
| `reactflow` | React Flow + CSS | < 180 KB | Eager |
| `monaco` | Monaco Editor | < 400 KB | Eager |
| `charts` | Recharts | < 80 KB | Eager |
| `g6` | AntV G6 | < 350 KB | **Lazy** — `/explore` route only |
| `three` | 3d-force-graph + Three.js | < 500 KB | **Lazy** — `/galaxy` route, Phase 3 |

Initial load total: ~740 KB gzipped.
With G6 (on first Explore visit): +350 KB, cached by browser thereafter.
With Three.js (Phase 3, Galaxy): +500 KB, separately cached.

---

## Animation Libraries

### Framer Motion — Page & Component Transitions

Use Framer Motion for all UI-level animations. Keep transitions under 300ms.

**Page transitions** — wrap routes in `AnimatePresence`:
```tsx
// App.tsx
import { AnimatePresence } from 'framer-motion';

<AnimatePresence mode="wait">
  <Routes location={location} key={location.pathname}>
    ...
  </Routes>
</AnimatePresence>
```

**Page wrapper** — every page component uses this standard variant:
```tsx
const pageVariants = {
  initial:  { opacity: 0, y: 8 },
  animate:  { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit:     { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

export default function SpacesPage() {
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
      ...
    </motion.div>
  );
}
```

**Staggered list entrance** — card grids:
```tsx
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, scale: 0.96 },
  show:   { opacity: 1, scale: 1, transition: { duration: 0.18 } },
};

<motion.ul variants={container} initial="hidden" animate="show">
  {spaces.map(s => (
    <motion.li key={s.id} variants={item}>
      <SpaceCard space={s} />
    </motion.li>
  ))}
</motion.ul>
```

**Modal entrance** — scale + fade:
```tsx
const modalVariants = {
  hidden:  { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1,   transition: { duration: 0.18, ease: 'easeOut' } },
  exit:    { opacity: 0, scale: 0.95, transition: { duration: 0.12 } },
};
```

**Slide-in panel** — right-side property editor on canvas:
```tsx
const panelVariants = {
  hidden:  { x: '100%', opacity: 0 },
  visible: { x: 0,      opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 30 } },
  exit:    { x: '100%', opacity: 0, transition: { duration: 0.2 } },
};
```

---

### GSAP — Complex Timeline Animations

Use GSAP for animations that require precise sequencing, canvas transitions,
or effects that Framer Motion can't express cleanly.

**Sidebar expand/collapse** — smooth height tween:
```tsx
import { gsap } from 'gsap';

const toggleFolder = (el: HTMLElement, open: boolean) => {
  gsap.to(el, {
    height:   open ? 'auto' : 0,
    opacity:  open ? 1 : 0,
    duration: 0.22,
    ease:     'power2.inOut',
  });
};
```

**Canvas node entrance** — stagger nodes on first load:
```tsx
import { gsap } from 'gsap';

useEffect(() => {
  gsap.from('.react-flow__node', {
    scale:    0.8,
    opacity:  0,
    duration: 0.3,
    stagger:  0.04,
    ease:     'back.out(1.4)',
  });
}, []);
```

**Rule:** GSAP is only for DOM refs and canvas elements. Never use GSAP
on React-controlled state — use Framer Motion for those.

---

### Lucide React — Icon Conventions

All icons come from `lucide-react`. Never import from any other icon library.

| Use case | Icon | Import |
|---|---|---|
| Space | `Globe` / `Lock` | `import { Globe } from 'lucide-react'` |
| Folder | `Folder` / `FolderOpen` | |
| Ontology | `BookOpen` | |
| Object type | `Box` | |
| Property | `Tag` | |
| Relationship | `ArrowRight` | |
| Add / Create | `Plus` | |
| Delete | `Trash2` | |
| Edit | `Pencil` | |
| Publish | `Upload` | |
| Export | `Download` | |
| Settings | `Settings` | |
| Search | `Search` | |
| Chevrons | `ChevronRight` / `ChevronDown` | |
| Close | `X` | |
| Check | `Check` | |
| Warning | `AlertTriangle` | |

Standard sizing:
```tsx
<Plus className="w-4 h-4" />          // inline buttons
<BookOpen className="w-5 h-5" />       // sidebar items
<Globe className="w-8 h-8" />          // hero / empty states
```

---

### Recharts — Ontology Health Dashboard

Use Recharts for all data visualisation. Import only the components you need.

**Ontology health bar chart:**
```tsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

<ResponsiveContainer width="100%" height={200}>
  <BarChart data={healthData}>
    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
    <YAxis tick={{ fontSize: 12 }} />
    <Tooltip />
    <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

**Object type property count sparkline:**
```tsx
import { LineChart, Line, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width={80} height={30}>
  <LineChart data={trend}>
    <Line type="monotone" dataKey="count" stroke="#6366f1" dot={false} strokeWidth={2} />
  </LineChart>
</ResponsiveContainer>
```

**Rule:** All charts live in `src/components/charts/`. Never put chart code
directly in page components.
