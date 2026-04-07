import React, { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Input, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SelectDropdown } from '@/components/ui/dropdown';
import { useCreateSpace } from '@/hooks/use-spaces';
import type { SpaceVisibility } from '@/types';

const VISIBILITY_OPTIONS = [
  { value: 'PRIVATE', label: 'Private — only you' },
  { value: 'SHARED', label: 'Shared — invite only' },
  { value: 'PUBLIC', label: 'Public — everyone' },
];

interface CreateSpaceModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreateSpaceModal({ open, onClose }: CreateSpaceModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<SpaceVisibility>('PRIVATE');
  const [errors, setErrors] = useState<{ name?: string }>({});

  const createSpace = useCreateSpace();

  const validate = () => {
    const e: { name?: string } = {};
    if (!name.trim()) e.name = 'Space name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    createSpace.mutate(
      { name: name.trim(), description: description.trim() || undefined, visibility },
      {
        onSuccess: () => {
          handleClose();
        },
      },
    );
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setVisibility('PRIVATE');
    setErrors({});
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create Space"
      description="A Space is the top-level container for all your ontologies."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Name"
          placeholder="e.g. Financial Data Domain"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors({});
          }}
          error={errors.name}
          autoFocus
        />

        <Textarea
          label="Description"
          placeholder="Describe the purpose of this space (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Visibility</label>
          <SelectDropdown
            value={visibility}
            onChange={(v) => setVisibility(v as SpaceVisibility)}
            options={VISIBILITY_OPTIONS}
          />
        </div>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={createSpace.isPending}>
            Create Space
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
