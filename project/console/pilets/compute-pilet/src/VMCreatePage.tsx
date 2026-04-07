import * as React from 'react';
import {
  Box, Typography, Paper, TextField, Button, MenuItem, Alert, ListSubheader, Chip,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { vmApi, publicImageApi, publicCloudInitApi, cloudInitApi, K8sResource } from './api';

interface OSImage {
  id: string;
  displayName: string;
  category: string;
  tags: string[];
}

interface CloudInitTemplate {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
}

type CloudInitSourceType = 'auto' | 'publicCloudInit' | 'cloudInit' | 'secret';

function toOSImage(r: K8sResource): OSImage {
  const spec = r.spec || {};
  return {
    id: r.metadata.name,
    displayName: (spec.displayName as string) || r.metadata.name,
    category: (spec.category as string) || 'other',
    tags: (spec.tags as string[]) || [],
  };
}

function toCloudInitTemplate(r: K8sResource): CloudInitTemplate {
  const spec = r.spec || {};
  return {
    id: r.metadata.name,
    displayName: (spec.displayName as string) || r.metadata.name,
    description: (spec.description as string) || '',
    tags: (spec.tags as string[]) || [],
  };
}

function groupByCategory(images: OSImage[]): Map<string, OSImage[]> {
  const sorted = [...images].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
  const groups = new Map<string, OSImage[]>();
  for (const img of sorted) {
    const cat = img.category || 'other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(img);
  }
  return groups;
}

export const VMCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [osImages, setOsImages] = React.useState<OSImage[]>([]);
  const [publicCloudInits, setPublicCloudInits] = React.useState<CloudInitTemplate[]>([]);
  const [userCloudInits, setUserCloudInits] = React.useState<CloudInitTemplate[]>([]);
  const [loadingImages, setLoadingImages] = React.useState(true);
  const [loadingCloudInits, setLoadingCloudInits] = React.useState(true);
  const [name, setName] = React.useState('');
  const [cores, setCores] = React.useState(2);
  const [memory, setMemory] = React.useState('4Gi');
  const [diskSize, setDiskSize] = React.useState('50Gi');
  const [image, setImage] = React.useState('');
  const [cloudInitSource, setCloudInitSource] = React.useState<CloudInitSourceType>('auto');
  const [selectedPublicCloudInit, setSelectedPublicCloudInit] = React.useState('');
  const [selectedCloudInit, setSelectedCloudInit] = React.useState('');
  const [secretName, setSecretName] = React.useState('');
  const [secretNamespace, setSecretNamespace] = React.useState('default');
  const [gpuCount, setGpuCount] = React.useState(0);
  const [sshPublicKey, setSshPublicKey] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    publicImageApi.list().then((items) => {
      const images = items.map(toOSImage);
      setOsImages(images);
      if (images.length > 0) setImage(images[0].id);
    }).catch((e) => {
      setError(`Failed to load OS images: ${e instanceof Error ? e.message : e}`);
    }).finally(() => setLoadingImages(false));

    Promise.all([
      publicCloudInitApi.list().then((items) => setPublicCloudInits(items.map(toCloudInitTemplate))).catch(() => {}),
      cloudInitApi.list().then((items) => setUserCloudInits(items.map(toCloudInitTemplate))).catch(() => {}),
    ]).finally(() => setLoadingCloudInits(false));
  }, []);

  const buildCloudInitRef = (): Record<string, unknown> | undefined => {
    switch (cloudInitSource) {
      case 'publicCloudInit':
        return selectedPublicCloudInit ? { publicCloudInit: selectedPublicCloudInit } : undefined;
      case 'cloudInit':
        return selectedCloudInit ? { cloudInit: selectedCloudInit } : undefined;
      case 'secret':
        return secretName ? { secret: { name: secretName, namespace: secretNamespace } } : undefined;
      default:
        return undefined;
    }
  };

  const handleCreate = async () => {
    if (!name) {
      setError('Name is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const cloudInitRef = buildCloudInitRef();
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
          ...(cloudInitRef && { cloudInit: cloudInitRef }),
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
          disabled={loadingImages}
          helperText={loadingImages ? 'Loading images...' : undefined}
        >
          {Array.from(groupByCategory(osImages)).map(([category, images]) => [
            <ListSubheader key={`header-${category}`} sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700 }}>
              {category}
            </ListSubheader>,
            ...images.map((os) => (
              <MenuItem key={os.id} value={os.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <span>{os.displayName}</span>
                  <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
                    {os.tags.map((tag) => (
                      <Chip key={tag} label={tag} size="small" sx={{ height: 18, fontSize: '0.625rem' }} />
                    ))}
                  </Box>
                </Box>
              </MenuItem>
            )),
          ]).flat()}
        </TextField>
        <TextField
          label="GPU Count" type="number" fullWidth sx={{ mb: 2 }}
          value={gpuCount} onChange={(e) => setGpuCount(Number(e.target.value))}
          slotProps={{ htmlInput: { min: 0, max: 8 } }}
        />

        {/* Cloud-Init Source Selection */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Cloud-Init Template</Typography>
        <ToggleButtonGroup
          value={cloudInitSource}
          exclusive
          onChange={(_, v) => v && setCloudInitSource(v as CloudInitSourceType)}
          size="small"
          sx={{ mb: 2 }}
        >
          <ToggleButton value="auto">Auto-detect</ToggleButton>
          <ToggleButton value="publicCloudInit">Public Template</ToggleButton>
          <ToggleButton value="cloudInit">Custom Template</ToggleButton>
          <ToggleButton value="secret">Secret</ToggleButton>
        </ToggleButtonGroup>

        {cloudInitSource === 'auto' && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A default cloud-init template will be selected based on the OS image.
          </Typography>
        )}

        {cloudInitSource === 'publicCloudInit' && (
          <TextField
            label="Public Cloud-Init Template" select fullWidth sx={{ mb: 2 }}
            value={selectedPublicCloudInit}
            onChange={(e) => setSelectedPublicCloudInit(e.target.value)}
            disabled={loadingCloudInits}
            helperText={loadingCloudInits ? 'Loading templates...' : 'Select a platform-provided cloud-init template'}
          >
            {publicCloudInits.map((ci) => (
              <MenuItem key={ci.id} value={ci.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <Box>
                    <span>{ci.displayName}</span>
                    {ci.description && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {ci.description}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
                    {ci.tags.slice(0, 3).map((tag) => (
                      <Chip key={tag} label={tag} size="small" sx={{ height: 18, fontSize: '0.625rem' }} />
                    ))}
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </TextField>
        )}

        {cloudInitSource === 'cloudInit' && (
          <TextField
            label="Custom Cloud-Init Template"
            select={userCloudInits.length > 0}
            fullWidth sx={{ mb: 2 }}
            value={selectedCloudInit}
            onChange={(e) => setSelectedCloudInit(e.target.value)}
            placeholder={userCloudInits.length === 0 ? 'my-cloud-init' : undefined}
            helperText={
              userCloudInits.length > 0
                ? 'Select a CloudInit resource from your workspace'
                : 'Enter the name of a CloudInit resource in your workspace'
            }
          >
            {userCloudInits.map((ci) => (
              <MenuItem key={ci.id} value={ci.id}>
                <Box>
                  <span>{ci.displayName || ci.id}</span>
                  {ci.description && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {ci.description}
                    </Typography>
                  )}
                </Box>
              </MenuItem>
            ))}
          </TextField>
        )}

        {cloudInitSource === 'secret' && (
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="Secret Name" fullWidth
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              placeholder="my-cloudinit-secret"
              helperText='Secret containing cloud-init user-data in the "userData" key'
            />
            <TextField
              label="Namespace" fullWidth
              value={secretNamespace}
              onChange={(e) => setSecretNamespace(e.target.value)}
              placeholder="default"
              sx={{ maxWidth: 200 }}
            />
          </Box>
        )}

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
