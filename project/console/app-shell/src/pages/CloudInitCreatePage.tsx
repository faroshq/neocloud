import * as React from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  TextField,
  CircularProgress,
  alpha,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { cloudInitApi, type K8sResource } from './api';

export const CloudInitCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams<{ name: string }>();
  const isEdit = !!params.name;

  const [name, setName] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [userData, setUserData] = React.useState(defaultUserData);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(isEdit);
  const [error, setError] = React.useState('');
  const [existing, setExisting] = React.useState<K8sResource | null>(null);

  React.useEffect(() => {
    if (!isEdit || !params.name) return;
    cloudInitApi
      .get(params.name)
      .then((ci) => {
        setExisting(ci);
        setName(ci.metadata.name);
        const spec = (ci.spec || {}) as Record<string, unknown>;
        setDisplayName((spec.displayName as string) || '');
        setDescription((spec.description as string) || '');
        setUserData((spec.userData as string) || '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isEdit, params.name]);

  const handleSubmit = async () => {
    if (!name.trim() || !userData.trim()) return;
    setSaving(true);
    setError('');
    try {
      const resource = {
        apiVersion: 'compute.cloud.platform/v1alpha1',
        kind: 'CloudInit',
        metadata: {
          name: name.trim(),
          ...(existing ? { resourceVersion: existing.metadata.resourceVersion } : {}),
        } as Record<string, unknown>,
        spec: {
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
          userData,
        },
      };
      if (isEdit) {
        await cloudInitApi.update(name.trim(), resource);
      } else {
        await cloudInitApi.create(resource);
      }
      navigate('/ci');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
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

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Button
        startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 16 }} />}
        onClick={() => navigate('/ci')}
        sx={{
          color: '#71717a',
          mb: 2,
          fontSize: '0.8125rem',
          '&:hover': { color: '#a1a1aa', bgcolor: 'transparent' },
        }}
      >
        Back to Templates
      </Button>

      <Typography variant="h5" sx={{ mb: 3 }}>
        {isEdit ? 'Edit Cloud Init Template' : 'Create Cloud Init Template'}
      </Typography>

      {error && (
        <Box
          sx={{
            p: 2,
            mb: 3,
            borderRadius: 2,
            bgcolor: alpha('#f87171', 0.08),
            border: '1px solid',
            borderColor: alpha('#f87171', 0.2),
          }}
        >
          <Typography sx={{ color: '#f87171', fontSize: '0.8125rem' }}>
            {error}
          </Typography>
        </Box>
      )}

      <Paper sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        <Box
          sx={{
            px: 3,
            py: 1.5,
            bgcolor: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
            Template Details
          </Typography>
        </Box>
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isEdit}
            required
            fullWidth
            size="small"
            helperText="Unique identifier for this template (lowercase, no spaces)"
          />
          <TextField
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            fullWidth
            size="small"
            helperText="Human-readable name shown in the UI"
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            size="small"
            helperText="Short description of what this template does"
          />
        </Box>
      </Paper>

      <Paper sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        <Box
          sx={{
            px: 3,
            py: 1.5,
            bgcolor: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
            User Data
          </Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: '#52525b' }}>
            {'Supports {{.Hostname}} and {{.SSHPublicKey}} variables'}
          </Typography>
        </Box>
        <Box sx={{ p: 3 }}>
          <TextField
            value={userData}
            onChange={(e) => setUserData(e.target.value)}
            required
            fullWidth
            multiline
            minRows={14}
            maxRows={30}
            size="small"
            slotProps={{
              input: {
                sx: {
                  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                  fontSize: '0.8rem',
                  lineHeight: 1.6,
                },
              },
            }}
          />
        </Box>
      </Paper>

      <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
        <Button
          onClick={() => navigate('/ci')}
          sx={{ color: '#a1a1aa' }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving || !name.trim() || !userData.trim()}
          sx={{
            px: 3,
            background: 'linear-gradient(135deg, #818cf8, #6366f1)',
            '&:hover': {
              background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
            },
          }}
        >
          {saving ? (
            <CircularProgress size={18} sx={{ color: '#fff' }} />
          ) : isEdit ? (
            'Save Changes'
          ) : (
            'Create Template'
          )}
        </Button>
      </Box>
    </Box>
  );
};

const defaultUserData = `#cloud-config
hostname: {{.Hostname}}
ssh_pwauth: true
disable_root: false
chpasswd:
  users:
    - name: root
      password: changeme
      type: text
  expire: false
packages:
  - openssh-server
runcmd:
  - sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
  - systemctl enable ssh || systemctl enable sshd || true
  - systemctl restart ssh || systemctl restart sshd || true
ssh_authorized_keys:
  - {{.SSHPublicKey}}
`;
