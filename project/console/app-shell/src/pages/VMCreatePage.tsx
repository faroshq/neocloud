import * as React from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  MenuItem,
  ListSubheader,
  Chip,
  ToggleButtonGroup,
  ToggleButton,
  alpha,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useNavigate } from 'react-router-dom';
import { vmApi, publicImageApi, publicCloudInitApi, cloudInitApi, K8sResource } from './api';

interface OSImage {
  id: string;
  displayName: string;
  os: string;
  category: string;
  tags: string[];
}

interface CloudInitTemplate {
  id: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
}

type CloudInitSourceType = 'auto' | 'publicCloudInit' | 'cloudInit' | 'secret';

function toOSImage(r: K8sResource): OSImage {
  const spec = r.spec || {};
  return {
    id: r.metadata.name,
    displayName: (spec.displayName as string) || r.metadata.name,
    os: (spec.os as string) || '',
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
    category: (spec.category as string) || 'other',
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

const TAG_COLORS: Record<string, string> = {
  lts: '#22c55e',
  stable: '#22c55e',
  enterprise: '#6366f1',
  rolling: '#f59e0b',
  testing: '#f59e0b',
  default: '#818cf8',
};

const toggleBtnSx = {
  fontSize: '0.75rem',
  fontWeight: 600,
  px: 1.5,
  py: 0.5,
  textTransform: 'none' as const,
  borderColor: 'rgba(255,255,255,0.1)',
  color: '#71717a',
  '&.Mui-selected': {
    bgcolor: alpha('#818cf8', 0.12),
    color: '#818cf8',
    borderColor: alpha('#818cf8', 0.3),
    '&:hover': { bgcolor: alpha('#818cf8', 0.18) },
  },
};

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
  const [diskImage, setDiskImage] = React.useState('');
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
      if (images.length > 0) setDiskImage(images[0].id);
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
          disk: { size: diskSize, image: diskImage },
          ...(gpuCount > 0 && { gpu: { count: gpuCount } }),
          ...(sshPublicKey && { ssh: { publicKey: sshPublicKey } }),
          ...(cloudInitRef && { cloudInit: cloudInitRef }),
        },
      });
      navigate('/vm');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create VM');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Box>
      <Button
        startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 16 }} />}
        onClick={() => navigate('/vm')}
        sx={{
          color: '#71717a',
          fontSize: '0.8125rem',
          mb: 1.5,
          px: 0,
          '&:hover': { color: '#fafafa', bgcolor: 'transparent' },
        }}
      >
        Virtual Machines
      </Button>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Create Virtual Machine
      </Typography>

      <Box sx={{ maxWidth: 640 }}>
        {error && (
          <Alert
            severity="error"
            sx={{
              mb: 3,
              borderRadius: 2,
              bgcolor: alpha('#f87171', 0.08),
              border: '1px solid',
              borderColor: alpha('#f87171', 0.2),
              color: '#f87171',
              '& .MuiAlert-icon': { color: '#f87171' },
            }}
          >
            {error}
          </Alert>
        )}

        {/* Instance name */}
        <Paper sx={{ p: 0, overflow: 'hidden', mb: 2 }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Instance Details
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <TextField
              label="Name"
              fullWidth
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-virtual-machine"
              helperText="A unique name for your virtual machine"
            />
          </Box>
        </Paper>

        {/* OS Image selection */}
        <Paper sx={{ p: 0, overflow: 'hidden', mb: 2 }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Operating System
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <TextField
              label="OS Image"
              select
              fullWidth
              value={diskImage}
              onChange={(e) => setDiskImage(e.target.value)}
              disabled={loadingImages}
              helperText={loadingImages ? 'Loading images...' : undefined}
            >
              {Array.from(groupByCategory(osImages)).map(([category, images]) => [
                <ListSubheader
                  key={`header-${category}`}
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.03)',
                    color: '#a1a1aa',
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    lineHeight: '32px',
                  }}
                >
                  {category}
                </ListSubheader>,
                ...images.map((os) => (
                  <MenuItem key={os.id} value={os.id} sx={{ py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                      <Typography sx={{ fontSize: '0.8125rem' }}>
                        {os.displayName}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
                        {os.tags.map((tag) => (
                          <Chip
                            key={tag}
                            label={tag}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: '0.625rem',
                              fontWeight: 600,
                              bgcolor: alpha(TAG_COLORS[tag] || '#71717a', 0.15),
                              color: TAG_COLORS[tag] || '#a1a1aa',
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
                        ))}
                      </Box>
                    </Box>
                  </MenuItem>
                )),
              ]).flat()}
            </TextField>
          </Box>
        </Paper>

        {/* Resources */}
        <Paper sx={{ p: 0, overflow: 'hidden', mb: 2 }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Resources
            </Typography>
          </Box>
          <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
              }}
            >
              <TextField
                label="CPU Cores"
                type="number"
                fullWidth
                value={cores}
                onChange={(e) => setCores(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 1, max: 64 } }}
              />
              <TextField
                label="Memory"
                fullWidth
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                helperText="e.g. 4Gi, 8Gi, 16Gi"
              />
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
              }}
            >
              <TextField
                label="Disk Size"
                fullWidth
                value={diskSize}
                onChange={(e) => setDiskSize(e.target.value)}
                helperText="e.g. 50Gi, 100Gi"
              />
              <TextField
                label="GPU Count"
                type="number"
                fullWidth
                value={gpuCount}
                onChange={(e) => setGpuCount(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, max: 8 } }}
              />
            </Box>
          </Box>
        </Paper>

        {/* Cloud-Init Template */}
        <Paper sx={{ p: 0, overflow: 'hidden', mb: 2 }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Cloud-Init Template
            </Typography>
            <Typography
              sx={{ fontSize: '0.75rem', color: '#52525b', mt: 0.25 }}
            >
              Configure initial VM setup
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <ToggleButtonGroup
              value={cloudInitSource}
              exclusive
              onChange={(_, v) => v && setCloudInitSource(v as CloudInitSourceType)}
              size="small"
              sx={{ mb: 2 }}
            >
              <ToggleButton value="auto" sx={toggleBtnSx}>Auto-detect</ToggleButton>
              <ToggleButton value="publicCloudInit" sx={toggleBtnSx}>Public Template</ToggleButton>
              <ToggleButton value="cloudInit" sx={toggleBtnSx}>Custom Template</ToggleButton>
              <ToggleButton value="secret" sx={toggleBtnSx}>Secret</ToggleButton>
            </ToggleButtonGroup>

            {cloudInitSource === 'auto' && (
              <Typography sx={{ fontSize: '0.8125rem', color: '#71717a' }}>
                A default cloud-init template will be selected based on the OS image.
              </Typography>
            )}

            {cloudInitSource === 'publicCloudInit' && (
              <TextField
                label="Public Cloud-Init Template"
                select
                fullWidth
                value={selectedPublicCloudInit}
                onChange={(e) => setSelectedPublicCloudInit(e.target.value)}
                disabled={loadingCloudInits}
                helperText={loadingCloudInits ? 'Loading templates...' : 'Select a platform-provided cloud-init template'}
              >
                {publicCloudInits.map((ci) => (
                  <MenuItem key={ci.id} value={ci.id} sx={{ py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                      <Box>
                        <Typography sx={{ fontSize: '0.8125rem' }}>
                          {ci.displayName}
                        </Typography>
                        {ci.description && (
                          <Typography sx={{ fontSize: '0.6875rem', color: '#71717a' }}>
                            {ci.description}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
                        {ci.tags.slice(0, 3).map((tag) => (
                          <Chip
                            key={tag}
                            label={tag}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: '0.625rem',
                              fontWeight: 600,
                              bgcolor: alpha(TAG_COLORS[tag] || '#71717a', 0.15),
                              color: TAG_COLORS[tag] || '#a1a1aa',
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
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
                fullWidth
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
                  <MenuItem key={ci.id} value={ci.id} sx={{ py: 1 }}>
                    <Box>
                      <Typography sx={{ fontSize: '0.8125rem' }}>
                        {ci.displayName || ci.id}
                      </Typography>
                      {ci.description && (
                        <Typography sx={{ fontSize: '0.6875rem', color: '#71717a' }}>
                          {ci.description}
                        </Typography>
                      )}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
            )}

            {cloudInitSource === 'secret' && (
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Secret Name"
                  fullWidth
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                  placeholder="my-cloudinit-secret"
                  helperText='Secret containing cloud-init user-data in the "userData" key'
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'monospace',
                      fontSize: '0.8125rem',
                    },
                  }}
                />
                <TextField
                  label="Namespace"
                  fullWidth
                  value={secretNamespace}
                  onChange={(e) => setSecretNamespace(e.target.value)}
                  placeholder="default"
                  sx={{
                    maxWidth: 200,
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'monospace',
                      fontSize: '0.8125rem',
                    },
                  }}
                />
              </Box>
            )}
          </Box>
        </Paper>

        {/* SSH Key */}
        <Paper sx={{ p: 0, overflow: 'hidden', mb: 3 }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Authentication
            </Typography>
            <Typography
              sx={{ fontSize: '0.75rem', color: '#52525b', mt: 0.25 }}
            >
              Optional
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <TextField
              label="SSH Public Key"
              fullWidth
              multiline
              rows={3}
              value={sshPublicKey}
              onChange={(e) => setSshPublicKey(e.target.value)}
              placeholder="ssh-ed25519 AAAA..."
              sx={{
                '& .MuiOutlinedInput-root': {
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                },
              }}
            />
          </Box>
        </Paper>

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleCreate}
          disabled={creating}
          sx={{
            py: 1.5,
            fontSize: '0.875rem',
            background: 'linear-gradient(135deg, #818cf8, #6366f1)',
            '&:hover': {
              background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
            },
          }}
        >
          {creating ? 'Creating...' : 'Create Virtual Machine'}
        </Button>
      </Box>
    </Box>
  );
};
