import React, { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useCreateFolder } from '@/hooks/use-folders';

interface CreateFolderModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  parentFolderId?: string | null;
}

export default function CreateFolderModal({
  open,
  onClose,
  spaceId,
  parentFolderId = null,
}: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();

  const createFolder = useCreateFolder(spaceId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }

    createFolder.mutate(
      { space_id: spaceId, parent_folder_id: parentFolderId, name: name.trim() },
      {
        onSuccess: () => {
          setName('');
          setError(undefined);
          onClose();
        },
      },
    );
  };

  const handleClose = () => {
    setName('');
    setError(undefined);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Folder"
      description="Folders help organise ontologies within a space."
      size="sm"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Folder name"
          placeholder="e.g. Trade Finance"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(undefined);
          }}
          error={error}
          autoFocus
        />

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={createFolder.isPending}>
            Create
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
