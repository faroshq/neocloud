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
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import { useNavigate } from 'react-router-dom';
import { cloudInitApi, type K8sResource } from './api';

export const CloudInitListPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<K8sResource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    cloudInitApi
      .list()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await cloudInitApi.delete(deleteTarget);
      setItems((prev) => prev.filter((i) => i.metadata.name !== deleteTarget));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const filtered = items.filter((i) =>
    i.metadata.name.toLowerCase().includes(search.toLowerCase()),
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
          <Typography variant="h5">Cloud Init Templates</Typography>
          <Typography
            sx={{ fontSize: '0.8125rem', color: '#52525b', mt: 0.25 }}
          >
            {items.length} template{items.length !== 1 ? 's' : ''}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={() => navigate('/ci/create')}
          sx={{
            px: 2.5,
            background: 'linear-gradient(135deg, #818cf8, #6366f1)',
            '&:hover': {
              background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
            },
          }}
        >
          Create Template
        </Button>
      </Box>

      <TextField
        placeholder="Search cloud-init templates..."
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
              <TableCell>Display Name</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Age</TableCell>
              <TableCell align="right" sx={{ width: 100 }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
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
                      <DescriptionRoundedIcon
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
                        ? 'No matching templates'
                        : 'No cloud-init templates yet'}
                    </Typography>
                    <Typography
                      sx={{ color: '#3f3f46', fontSize: '0.8125rem' }}
                    >
                      {search
                        ? 'Try a different search term'
                        : 'Create a template to customize VM provisioning'}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => {
                const spec = (item.spec || {}) as Record<string, unknown>;
                const age = item.metadata.creationTimestamp
                  ? timeSince(new Date(item.metadata.creationTimestamp))
                  : '-';
                return (
                  <TableRow
                    key={item.metadata.name}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.02) !important',
                      },
                      transition: 'background 0.15s ease',
                    }}
                    onClick={() => navigate(`/ci/${item.metadata.name}`)}
                  >
                    <TableCell>
                      <Typography
                        sx={{ fontWeight: 600, fontSize: '0.8125rem' }}
                      >
                        {item.metadata.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{ fontSize: '0.8125rem', color: '#a1a1aa' }}
                      >
                        {(spec.displayName as string) || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#71717a',
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {(spec.description as string) || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{ fontSize: '0.8125rem', color: '#71717a' }}
                      >
                        {age}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton
                        size="small"
                        onClick={() =>
                          navigate(`/ci/${item.metadata.name}/edit`)
                        }
                        sx={{
                          color: '#52525b',
                          '&:hover': {
                            color: '#818cf8',
                            bgcolor: alpha('#818cf8', 0.1),
                          },
                        }}
                      >
                        <EditRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => setDeleteTarget(item.metadata.name)}
                        sx={{
                          color: '#52525b',
                          '&:hover': {
                            color: '#f87171',
                            bgcolor: alpha('#f87171', 0.1),
                          },
                        }}
                      >
                        <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
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

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
