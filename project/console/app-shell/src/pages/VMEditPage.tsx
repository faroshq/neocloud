import * as React from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  CircularProgress,
  MenuItem,
  Chip,
  ToggleButtonGroup,
  ToggleButton,
  FormControlLabel,
  Checkbox,
  alpha,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useParams, useNavigate } from 'react-router-dom';
import { vmApi, publicCloudInitApi, cloudInitApi, K8sResource } from './api';

const OS_IMAGES = [
  { id: 'ubuntu-22.04', name: 'Ubuntu', version: '22.04 LTS', color: '#E95420' },
  { id: 'ubuntu-24.04', name: 'Ubuntu', version: '24.04 LTS', color: '#E95420' },
  { id: 'debian-12', name: 'Debian', version: '12 Bookworm', color: '#A80030' },
  { id: 'flatcar', name: 'Flatcar', version: 'Stable', color: '#4A90D9' },
];

interface CloudInitTemplate {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
}

type CloudInitSourceType = 'auto' | 'publicCloudInit' | 'cloudInit' | 'secret';

function toCloudInitTemplate(r: K8sResource): CloudInitTemplate {
  const spec = r.spec || {};
  return {
    id: r.metadata.name,
    displayName: (spec.displayName as string) || r.metadata.name,
    description: (spec.description as string) || '',
    tags: (spec.tags as string[]) || [],
  };
}

const TAG_COLORS: Record<string, string> = {
  lts: '#22c55e',
  stable: '#22c55e',
  enterprise: '#6366f1',
  rolling: '#f59e0b',
  testing: '#f59e0b',
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

export const VMEditPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [original, setOriginal] = React.useState<Record<string, unknown> | null>(null);

  const [cores, setCores] = React.useState(2);
  const [memory, setMemory] = React.useState('4Gi');
  const [diskSize, setDiskSize] = React.useState('50Gi');
  const [diskImage, setDiskImage] = React.useState(OS_IMAGES[0].id);
  const [gpuCount, setGpuCount] = React.useState(0);
  const [sshPublicKey, setSshPublicKey] = React.useState('');
  const [enableRootLogin, setEnableRootLogin] = React.useState(false);
  const [cloudInitSource, setCloudInitSource] = React.useState<CloudInitSourceType>('auto');
  const [selectedPublicCloudInit, setSelectedPublicCloudInit] = React.useState('');
  const [selectedCloudInit, setSelectedCloudInit] = React.useState('');
  const [secretName, setSecretName] = React.useState('');
  const [secretNamespace, setSecretNamespace] = React.useState('default');
  const [publicCloudInits, setPublicCloudInits] = React.useState<CloudInitTemplate[]>([]);
  const [userCloudInits, setUserCloudInits] = React.useState<CloudInitTemplate[]>([]);
  const [loadingCloudInits, setLoadingCloudInits] = React.useState(true);

  React.useEffect(() => {
    Promise.all([
      publicCloudInitApi.list().then((items) => setPublicCloudInits(items.map(toCloudInitTemplate))).catch(() => {}),
      cloudInitApi.list().then((items) => setUserCloudInits(items.map(toCloudInitTemplate))).catch(() => {}),
    ]).finally(() => setLoadingCloudInits(false));
  }, []);

  React.useEffect(() => {
    if (!name) return;
    vmApi
      .get(name)
      .then((vm) => {
        setOriginal(vm as unknown as Record<string, unknown>);
        const spec = (vm.spec || {}) as Record<string, unknown>;
        const disk = (spec.disk || {}) as Record<string, unknown>;
        const gpu = (spec.gpu || {}) as Record<string, unknown>;
        const ssh = (spec.ssh || {}) as Record<string, unknown>;
        const ci = (spec.cloudInit || {}) as Record<string, unknown>;
        setCores((spec.cores as number) || 2);
        setMemory((spec.memory as string) || '4Gi');
        setDiskSize((disk.size as string) || '50Gi');
        setDiskImage((disk.image as string) || OS_IMAGES[0].id);
        setGpuCount((gpu.count as number) || 0);
        setSshPublicKey((ssh.publicKey as string) || '');
        setEnableRootLogin(!!(ssh.enableRootLogin));
        // Restore cloud-init source type from existing spec.
        if (ci.publicCloudInit) {
          setCloudInitSource('publicCloudInit');
          setSelectedPublicCloudInit(ci.publicCloudInit as string);
        } else if (ci.cloudInit) {
          setCloudInitSource('cloudInit');
          setSelectedCloudInit(ci.cloudInit as string);
        } else if (ci.secret) {
          setCloudInitSource('secret');
          const secretRef = ci.secret as Record<string, string>;
          setSecretName(secretRef.name || '');
          setSecretNamespace(secretRef.namespace || 'default');
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [name]);

  const handleSave = async () => {
    if (!name || !original) return;
    setSaving(true);
    setError('');
    try {
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
      const cloudInitRef = buildCloudInitRef();
      const updated = {
        ...original,
        spec: {
          cores,
          memory,
          disk: { size: diskSize, image: diskImage },
          ...(gpuCount > 0 && { gpu: { count: gpuCount } }),
          ...((sshPublicKey || enableRootLogin) && {
            ssh: {
              ...(sshPublicKey && { publicKey: sshPublicKey }),
              ...(enableRootLogin && { enableRootLogin: true }),
            },
          }),
          ...(cloudInitRef && { cloudInit: cloudInitRef }),
        },
      };
      await vmApi.update(name, updated);
      navigate(`/vm/${name}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update VM');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 400,
        }}
      >
        <CircularProgress size={28} sx={{ color: '#818cf8' }} />
      </Box>
    );
  }

  if (error && !original) {
    return (
      <Box
        sx={{
          p: 3,
          borderRadius: 2,
          bgcolor: alpha('#f87171', 0.08),
          border: '1px solid',
          borderColor: alpha('#f87171', 0.2),
        }}
      >
        <Typography sx={{ color: '#f87171', fontSize: '0.875rem' }}>
          {error}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Button
        startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 16 }} />}
        onClick={() => navigate(`/vm/${name}`)}
        sx={{
          color: '#71717a',
          fontSize: '0.8125rem',
          mb: 1.5,
          px: 0,
          '&:hover': { color: '#fafafa', bgcolor: 'transparent' },
        }}
      >
        {name}
      </Button>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Edit Virtual Machine
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

        {/* Instance name (read-only) */}
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
            <TextField label="Name" fullWidth value={name} disabled />
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
          <Box
            sx={{
              p: 2.5,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 1.5,
            }}
          >
            {OS_IMAGES.map((os) => {
              const selected = diskImage === os.id;
              return (
                <Box
                  key={os.id}
                  onClick={() => setDiskImage(os.id)}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: selected
                      ? alpha(os.color, 0.5)
                      : 'rgba(255,255,255,0.08)',
                    bgcolor: selected
                      ? alpha(os.color, 0.06)
                      : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    textAlign: 'center',
                    '&:hover': {
                      borderColor: selected
                        ? alpha(os.color, 0.5)
                        : 'rgba(255,255,255,0.15)',
                      bgcolor: selected
                        ? alpha(os.color, 0.06)
                        : 'rgba(255,255,255,0.03)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      bgcolor: alpha(os.color, 0.15),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 1,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: os.color,
                      }}
                    >
                      {os.name.charAt(0)}
                    </Typography>
                  </Box>
                  <Typography
                    sx={{ fontSize: '0.8125rem', fontWeight: 600, mb: 0.25 }}
                  >
                    {os.name}
                  </Typography>
                  <Typography
                    sx={{ fontSize: '0.6875rem', color: '#71717a' }}
                  >
                    {os.version}
                  </Typography>
                </Box>
              );
            })}
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
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
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
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
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
                helperText="Select a platform-provided cloud-init template"
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
          <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
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
            <FormControlLabel
              control={
                <Checkbox
                  checked={enableRootLogin}
                  onChange={(e) => setEnableRootLogin(e.target.checked)}
                  sx={{ color: '#71717a', '&.Mui-checked': { color: '#818cf8' } }}
                />
              }
              label={
                <Box>
                  <Typography sx={{ fontSize: '0.8125rem' }}>
                    Enable root SSH login
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: '#52525b' }}>
                    A random root password will be generated and stored in a Secret
                  </Typography>
                </Box>
              }
            />
          </Box>
        </Paper>

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleSave}
          disabled={saving}
          sx={{
            py: 1.5,
            fontSize: '0.875rem',
            background: 'linear-gradient(135deg, #818cf8, #6366f1)',
            '&:hover': {
              background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
            },
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </Box>
    </Box>
  );
};
