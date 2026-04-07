// ─── Enumerations ───────────────────────────────────────────────────────────

export type SpaceVisibility = 'PUBLIC' | 'PRIVATE' | 'SHARED';
export type OntologyStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';
export type PropertyDataType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'uri';
export type Cardinality = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_MANY';
export type ResourceType =
  | 'SPACE'
  | 'FOLDER'
  | 'ONTOLOGY'
  | 'OBJECT_TYPE'
  | 'PROPERTY'
  | 'RELATIONSHIP';
export type ActionPermission = 'READ' | 'WRITE' | 'EDIT' | 'DELETE';
export type PolicyType = 'RBAC' | 'ABAC';

// ─── Core Domain Models ──────────────────────────────────────────────────────

export interface Space {
  id: string;
  name: string;
  description: string | null;
  visibility: SpaceVisibility;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  space_id: string;
  parent_folder_id: string | null;
  name: string;
  created_at: string;
}

export interface Ontology {
  id: string;
  folder_id: string;
  space_id: string;
  name: string;
  description: string | null;
  version: string;
  status: OntologyStatus;
  created_at: string;
  updated_at: string;
}

export interface ObjectType {
  id: string;
  ontology_id: string;
  api_name: string;
  display_name: string;
  description: string | null;
  primary_key: string;
  is_skos_concept: boolean;
  is_skos_concept_scheme: boolean;
  created_at: string;
}

export interface Property {
  id: string;
  object_type_id: string;
  api_name: string;
  display_name: string;
  data_type: PropertyDataType;
  required: boolean;
  skos_mapping: string | null;
  created_at: string;
}

export interface Relationship {
  id: string;
  ontology_id: string;
  api_name: string;
  source_object_type_id: string;
  target_object_type_id: string;
  cardinality: Cardinality;
  created_at: string;
}

// ─── Create / Update Payloads ────────────────────────────────────────────────

export interface SpaceCreate {
  name: string;
  description?: string;
  visibility: SpaceVisibility;
}

export interface FolderCreate {
  space_id: string;
  parent_folder_id?: string | null;
  name: string;
}

export interface OntologyCreate {
  folder_id: string;
  space_id: string;
  name: string;
  description?: string;
}

export interface ObjectTypeCreate {
  ontology_id: string;
  api_name: string;
  display_name: string;
  description?: string;
  primary_key: string;
  is_skos_concept?: boolean;
  is_skos_concept_scheme?: boolean;
}

export interface PropertyCreate {
  object_type_id: string;
  api_name: string;
  display_name: string;
  data_type: PropertyDataType;
  required?: boolean;
  skos_mapping?: string | null;
}

export interface RelationshipCreate {
  ontology_id: string;
  api_name: string;
  source_object_type_id: string;
  target_object_type_id: string;
  cardinality: Cardinality;
}

// ─── API Error ───────────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
}

// ─── Canvas / React Flow ─────────────────────────────────────────────────────

export interface ObjectTypeNodeData extends Record<string, unknown> {
  objectType: ObjectType;
  properties: Property[];
  onSelect: (id: string) => void;
}

export interface RelationshipEdgeData extends Record<string, unknown> {
  relationship: Relationship;
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
}

export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
  ontologies: Ontology[];
}
