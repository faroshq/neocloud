import * as React from 'react';
import {
  Box, Typography, Paper, TextField, Button, MenuItem, Alert,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { vmApi } from './api';

const OS_IMAGES = ['ubuntu-22.04', 'ubuntu-24.04', 'debian-12', 'flatcar'];

export const VMCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = React.useState('');
  const [cores, setCores] = React.useState(2);
  const [memory, setMemory] = React.useState('4Gi');
  const [diskSize, setDiskSize] = React.useState('50Gi');
  const [image, setImage] = React.useState(OS_IMAGES[0]);
  const [gpuCount, setGpuCount] = React.useState(0);
  const [sshPublicKey, setSshPublicKey] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleCreate = async () => {
    if (!name) {
      setError('Name is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await vmApi.create({
        apiVersion: 'compute.cloud.platform/v1alpha1',
        kind: 'VirtualMachine',
        metadata: { name },
        spec: {
          cores,
          memory,
          diskSize,
          image,
          ...(gpuCount > 0 && { gpuCount }),
          ...(sshPublicKey && { sshPublicKey }),
        },
      });
      navigate('/console/vm');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create VM');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button variant="text" onClick={() => navigate('/console/vm')}>&larr; Back</Button>
        <Typography variant="h5">Create Virtual Machine</Typography>
      </Box>
      <Paper sx={{ p: 3, maxWidth: 600 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="Name" fullWidth required sx={{ mb: 2 }}
          value={name} onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="CPU Cores" type="number" fullWidth sx={{ mb: 2 }}
          value={cores} onChange={(e) => setCores(Number(e.target.value))}
          slotProps={{ htmlInput: { min: 1, max: 64 } }}
        />
        <TextField
          label="Memory" fullWidth sx={{ mb: 2 }}
          value={memory} onChange={(e) => setMemory(e.target.value)}
          helperText="e.g. 4Gi, 8Gi, 16Gi"
        />
        <TextField
          label="Disk Size" fullWidth sx={{ mb: 2 }}
          value={diskSize} onChange={(e) => setDiskSize(e.target.value)}
          helperText="e.g. 50Gi, 100Gi"
        />
        <TextField
          label="OS Image" select fullWidth sx={{ mb: 2 }}
          value={image} onChange={(e) => setImage(e.target.value)}
        >
          {OS_IMAGES.map((img) => (
            <MenuItem key={img} value={img}>{img}</MenuItem>
          ))}
        </TextField>
        <TextField
          label="GPU Count" type="number" fullWidth sx={{ mb: 2 }}
          value={gpuCount} onChange={(e) => setGpuCount(Number(e.target.value))}
          slotProps={{ htmlInput: { min: 0, max: 8 } }}
        />
        <TextField
          label="SSH Public Key" fullWidth multiline rows={3} sx={{ mb: 3 }}
          value={sshPublicKey} onChange={(e) => setSshPublicKey(e.target.value)}
          placeholder="ssh-ed25519 AAAA..."
        />
        <Button
          variant="contained" fullWidth size="large"
          onClick={handleCreate} disabled={creating}
        >
          {creating ? 'Creating...' : 'Create VM'}
        </Button>
      </Paper>
    </Box>
  );
};
