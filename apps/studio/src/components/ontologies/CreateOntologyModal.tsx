import React, { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Input, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useCreateOntology } from '@/hooks/use-ontologies';

interface CreateOntologyModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  folderId: string;
}

export default function CreateOntologyModal({
  open,
  onClose,
  spaceId,
  folderId,
}: CreateOntologyModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ name?: string }>({});

  const createOntology = useCreateOntology(spaceId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: 'Ontology name is required' });
      return;
    }

    createOntology.mutate(
      {
        space_id: spaceId,
        folder_id: folderId,
        name: name.trim(),
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setName('');
          setDescription('');
          setErrors({});
          onClose();
        },
      },
    );
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setErrors({});
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Ontology"
      description="Create a new ontology inside the selected folder."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Name"
          placeholder="e.g. Trade Finance Ontology"
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
          placeholder="Describe the scope of this ontology (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={createOntology.isPending}>
            Create Ontology
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
