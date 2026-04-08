import * as React from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  CircularProgress,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { cloudInitApi, type K8sResource } from './api';

export const CloudInitDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const [ci, setCi] = React.useState<K8sResource | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [showDelete, setShowDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!name) return;
    cloudInitApi
      .get(name)
      .then(setCi)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [name]);

  const handleDelete = async () => {
    if (!name) return;
    setDeleting(true);
    try {
      await cloudInitApi.delete(name);
      navigate('/ci');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
      setDeleting(false);
      setShowDelete(false);
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

  if (error || !ci) {
    return (
      <Box>
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
            {error || 'Template not found'}
          </Typography>
        </Box>
      </Box>
    );
  }

  const spec = (ci.spec || {}) as Record<string, unknown>;

  return (
    <Box>
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

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h5">{ci.metadata.name}</Typography>
          {spec.displayName ? (
            <Typography
              sx={{ fontSize: '0.875rem', color: '#71717a', mt: 0.25 }}
            >
              {String(spec.displayName)}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<EditRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={() => navigate(`/ci/${ci.metadata.name}/edit`)}
            sx={{
              borderColor: 'rgba(255,255,255,0.12)',
              color: '#a1a1aa',
              '&:hover': {
                borderColor: '#818cf8',
                color: '#818cf8',
              },
            }}
          >
            Edit
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={() => setShowDelete(true)}
            sx={{
              borderColor: 'rgba(255,255,255,0.12)',
              color: '#a1a1aa',
              '&:hover': {
                borderColor: '#f87171',
                color: '#f87171',
              },
            }}
          >
            Delete
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 3,
          mb: 3,
        }}
      >
        <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            sx={{
              px: 3,
              py: 1.5,
              bgcolor: 'rgba(255,255,255,0.02)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
              Details
            </Typography>
          </Box>
          <Box sx={{ p: 3 }}>
            <DetailRow label="Name" value={ci.metadata.name} mono />
            <DetailRow
              label="Display Name"
              value={(spec.displayName as string) || '-'}
            />
            <DetailRow
              label="Description"
              value={(spec.description as string) || '-'}
            />
            <DetailRow
              label="Created"
              value={
                ci.metadata.creationTimestamp
                  ? new Date(ci.metadata.creationTimestamp).toLocaleString()
                  : '-'
              }
            />
          </Box>
        </Paper>
      </Box>

      <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{
            px: 3,
            py: 1.5,
            bgcolor: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
            User Data
          </Typography>
        </Box>
        <Box sx={{ p: 3 }}>
          <Box
            sx={{
              p: 2,
              borderRadius: 1.5,
              bgcolor: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              fontSize: '0.8rem',
              lineHeight: 1.7,
              color: '#d4d4d8',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 500,
              overflow: 'auto',
            }}
          >
            {(spec.userData as string) || '(empty)'}
          </Box>
        </Box>
      </Paper>

      <Dialog open={showDelete} onClose={() => setShowDelete(false)}>
        <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>
          Delete Cloud Init Template
        </DialogTitle>
        <DialogContent>
          <DialogContentText
            sx={{ color: '#a1a1aa', fontSize: '0.875rem' }}
          >
            Are you sure you want to delete{' '}
            <Box
              component="span"
              sx={{ fontWeight: 600, color: '#fafafa' }}
            >
              {ci.metadata.name}
            </Box>
            ? VMs referencing this template will fall back to auto-detect.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={() => setShowDelete(false)}
            disabled={deleting}
            sx={{ color: '#a1a1aa' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            disabled={deleting}
            sx={{
              bgcolor: '#f87171',
              '&:hover': { bgcolor: '#ef4444' },
            }}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const DetailRow: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <Box sx={{ display: 'flex', py: 1, '&:not(:last-child)': { borderBottom: '1px solid rgba(255,255,255,0.04)' } }}>
    <Typography
      sx={{
        fontSize: '0.8125rem',
        color: '#52525b',
        fontWeight: 500,
        minWidth: 140,
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        fontSize: '0.8125rem',
        color: '#d4d4d8',
        fontFamily: mono ? 'monospace' : 'inherit',
      }}
    >
      {value}
    </Typography>
  </Box>
);
