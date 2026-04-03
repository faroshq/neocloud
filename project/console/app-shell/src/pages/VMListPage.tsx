import * as React from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  InputAdornment,
  TextField,
  alpha,
} from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import { useNavigate } from 'react-router-dom';
import { vmApi, type K8sResource } from './api';
import { keyframes } from '@emotion/react';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const statusConfig: Record<
  string,
  { color: string; animate: boolean }
> = {
  Running: { color: '#34d399', animate: false },
  Provisioning: { color: '#fbbf24', animate: true },
  Pending: { color: '#fbbf24', animate: true },
  Failed: { color: '#f87171', animate: false },
  Stopped: { color: '#52525b', animate: false },
};

const StatusDot: React.FC<{ phase: string }> = ({ phase }) => {
  const config = statusConfig[phase] || {
    color: '#52525b',
    animate: false,
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          bgcolor: config.color,
          boxShadow: `0 0 6px ${alpha(config.color, 0.4)}`,
          animation: config.animate
            ? `${pulse} 2s ease-in-out infinite`
            : 'none',
        }}
      />
      <Typography
        sx={{
          fontSize: '0.8125rem',
          fontWeight: 500,
          color: config.color,
        }}
      >
        {phase}
      </Typography>
    </Box>
  );
};

export const VMListPage: React.FC = () => {
  const navigate = useNavigate();
  const [vms, setVms] = React.useState<K8sResource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    vmApi
      .list()
      .then(setVms)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await vmApi.delete(deleteTarget);
      setVms((prev) =>
        prev.filter((v) => v.metadata.name !== deleteTarget),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete VM');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const filtered = vms.filter((vm) =>
    vm.metadata.name.toLowerCase().includes(search.toLowerCase()),
  );

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

  if (error) {
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
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h5">Virtual Machines</Typography>
          <Typography
            sx={{ fontSize: '0.8125rem', color: '#52525b', mt: 0.25 }}
          >
            {vms.length} instance{vms.length !== 1 ? 's' : ''}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={() => navigate('/vm/create')}
          sx={{
            px: 2.5,
            background: 'linear-gradient(135deg, #818cf8, #6366f1)',
            '&:hover': {
              background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
            },
          }}
        >
          Create VM
        </Button>
      </Box>

      <TextField
        placeholder="Search virtual machines..."
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2, maxWidth: 320 }}
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon
                  sx={{ fontSize: 18, color: '#52525b' }}
                />
              </InputAdornment>
            ),
          },
        }}
      />

      <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Cores</TableCell>
              <TableCell>Memory</TableCell>
              <TableCell>Image</TableCell>
              <TableCell>GPU</TableCell>
              <TableCell>IP Address</TableCell>
              <TableCell align="right" sx={{ width: 100 }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Box sx={{ py: 8, px: 4 }}>
                    <Box
                      sx={{
                        width: 56,
                        height: 56,
                        borderRadius: 3,
                        bgcolor: 'rgba(255,255,255,0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto',
                        mb: 2,
                      }}
                    >
                      <DnsRoundedIcon
                        sx={{ fontSize: 28, color: '#3f3f46' }}
                      />
                    </Box>
                    <Typography
                      sx={{
                        color: '#71717a',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        mb: 0.5,
                      }}
                    >
                      {search
                        ? 'No matching virtual machines'
                        : 'No virtual machines yet'}
                    </Typography>
                    <Typography
                      sx={{ color: '#3f3f46', fontSize: '0.8125rem' }}
                    >
                      {search
                        ? 'Try a different search term'
                        : 'Create your first VM to get started'}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((vm) => {
                const spec = (vm.spec || {}) as Record<string, unknown>;
                const disk = (spec.disk || {}) as Record<
                  string,
                  unknown
                >;
                const gpu = (spec.gpu || {}) as Record<
                  string,
                  unknown
                >;
                const status = (vm.status || {}) as Record<
                  string,
                  unknown
                >;
                const phase = (status.phase as string) || 'Unknown';
                const internalIP =
                  (status.internalIP as string) || '';
                return (
                  <TableRow
                    key={vm.metadata.name}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.02) !important',
                      },
                      transition: 'background 0.15s ease',
                    }}
                    onClick={() =>
                      navigate(`/vm/${vm.metadata.name}`)
                    }
                  >
                    <TableCell>
                      <Typography
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.8125rem',
                        }}
                      >
                        {vm.metadata.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusDot phase={phase} />
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#a1a1aa',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {(spec.cores as number) || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#a1a1aa',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {(spec.memory as string) || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.75rem',
                          color: '#71717a',
                          px: 1,
                          py: 0.25,
                          bgcolor: 'rgba(255,255,255,0.04)',
                          borderRadius: 1,
                          display: 'inline-block',
                          fontFamily: 'monospace',
                        }}
                      >
                        {(disk.image as string) || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#a1a1aa',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {(gpu.count as number) || 0}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#a1a1aa',
                          fontFamily: 'monospace',
                        }}
                      >
                        {internalIP || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton
                        size="small"
                        onClick={() =>
                          navigate(
                            `/vm/${vm.metadata.name}/edit`,
                          )
                        }
                        sx={{
                          color: '#52525b',
                          '&:hover': {
                            color: '#818cf8',
                            bgcolor: alpha('#818cf8', 0.1),
                          },
                        }}
                      >
                        <EditRoundedIcon
                          sx={{ fontSize: 16 }}
                        />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() =>
                          setDeleteTarget(vm.metadata.name)
                        }
                        sx={{
                          color: '#52525b',
                          '&:hover': {
                            color: '#f87171',
                            bgcolor: alpha('#f87171', 0.1),
                          },
                        }}
                      >
                        <DeleteOutlineRoundedIcon
                          sx={{ fontSize: 16 }}
                        />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
      >
        <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>
          Delete Virtual Machine
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
              {deleteTarget}
            </Box>
            ? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={() => setDeleteTarget(null)}
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
