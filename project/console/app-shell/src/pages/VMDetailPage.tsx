import * as React from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  alpha,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useParams, useNavigate } from 'react-router-dom';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { vmApi, secretApi, type K8sResource } from './api';
import { keyframes } from '@emotion/react';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const statusConfig: Record<string, { color: string; animate: boolean }> = {
  Running: { color: '#34d399', animate: false },
  Provisioning: { color: '#fbbf24', animate: true },
  Pending: { color: '#fbbf24', animate: true },
  Failed: { color: '#f87171', animate: false },
  Stopped: { color: '#52525b', animate: false },
};

const RootPasswordCopy: React.FC<{ status: Record<string, unknown> }> = ({ status }) => {
  const [password, setPassword] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState('');

  const rootPwSecret = status.rootPasswordSecret as Record<string, string> | undefined;

  const handleCopy = async () => {
    if (password) {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    if (!rootPwSecret?.name || !rootPwSecret?.namespace) {
      setError('No root password Secret found in VM status');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const secret = await secretApi.get(rootPwSecret.namespace, rootPwSecret.name) as unknown as Record<string, unknown>;
      const data = (secret['data'] || {}) as Record<string, string>;
      const stringData = (secret['stringData'] || {}) as Record<string, string>;
      const pw = stringData?.password || (data?.password ? atob(data.password) : '');
      if (!pw) {
        setError('Secret does not contain a "password" key');
        return;
      }
      setPassword(pw);
      await navigator.clipboard.writeText(pw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch Secret');
    } finally {
      setLoading(false);
    }
  };

  if (!rootPwSecret) {
    return (
      <Typography sx={{ fontSize: '0.8125rem', color: '#71717a' }}>
        Root password Secret not yet created (VM may still be provisioning)
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: '0.8125rem', color: '#a1a1aa' }}>
          Secret: <span style={{ fontFamily: 'monospace' }}>{rootPwSecret.namespace}/{rootPwSecret.name}</span>
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />}
          onClick={handleCopy}
          disabled={loading}
          sx={{
            fontSize: '0.75rem',
            textTransform: 'none',
            borderColor: copied ? alpha('#22c55e', 0.4) : 'rgba(255,255,255,0.12)',
            color: copied ? '#22c55e' : '#a1a1aa',
            '&:hover': { borderColor: alpha('#818cf8', 0.4), color: '#818cf8' },
          }}
        >
          {loading ? 'Fetching...' : copied ? 'Copied!' : 'Copy Root Password'}
        </Button>
        {password && (
          <Typography
            sx={{
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              color: '#52525b',
              userSelect: 'all',
            }}
          >
            {password}
          </Typography>
        )}
      </Box>
      {error && (
        <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};

export const VMDetailPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [vm, setVm] = React.useState<K8sResource | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [showDelete, setShowDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!name) return;
    vmApi
      .get(name)
      .then(setVm)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [name]);

  const handleDelete = async () => {
    if (!name) return;
    setDeleting(true);
    try {
      await vmApi.delete(name);
      navigate('/vm');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete VM');
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

  if (!vm) {
    return (
      <Typography color="text.secondary">
        Virtual machine not found
      </Typography>
    );
  }

  const spec = (vm.spec || {}) as Record<string, unknown>;
  const disk = (spec.disk || {}) as Record<string, unknown>;
  const gpu = (spec.gpu || {}) as Record<string, unknown>;
  const ssh = (spec.ssh || {}) as Record<string, unknown>;
  const cloudInit = (spec.cloudInit || {}) as Record<string, unknown>;
  const status = (vm.status || {}) as Record<string, unknown>;
  const phase = (status.phase as string) || 'Unknown';
  const conditions =
    (status.conditions as Array<Record<string, string>>) || [];
  const config = statusConfig[phase] || {
    color: '#52525b',
    animate: false,
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
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
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Typography variant="h5">{vm.metadata.name}</Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1.25,
              py: 0.375,
              borderRadius: 1.5,
              bgcolor: alpha(config.color, 0.1),
              border: '1px solid',
              borderColor: alpha(config.color, 0.2),
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: config.color,
                animation: config.animate
                  ? `${pulse} 2s ease-in-out infinite`
                  : 'none',
              }}
            />
            <Typography
              sx={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: config.color,
              }}
            >
              {phase}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            size="small"
            startIcon={<EditRoundedIcon sx={{ fontSize: 15 }} />}
            onClick={() => navigate(`/vm/${name}/edit`)}
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
            startIcon={
              <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
            }
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

      {/* Spec & Status cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 2,
        }}
      >
        <Paper sx={{ p: 0, overflow: 'hidden' }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography
              sx={{ fontSize: '0.8125rem', fontWeight: 600 }}
            >
              Specification
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <InfoRow label="CPU Cores" value={spec.cores} mono />
            <InfoRow label="Memory" value={spec.memory} mono />
            <InfoRow label="Disk Size" value={disk.size} mono />
            <InfoRow label="Image" value={disk.image} mono />
            <InfoRow
              label="GPU Count"
              value={gpu.count || 0}
              mono
            />
            {cloudInit.publicCloudInit ? (
              <InfoRow label="Cloud-Init" value={cloudInit.publicCloudInit} mono />
            ) : cloudInit.cloudInit ? (
              <InfoRow label="Cloud-Init" value={cloudInit.cloudInit} mono />
            ) : cloudInit.secret ? (
              <InfoRow label="Cloud-Init" value={`Secret: ${(cloudInit.secret as Record<string, string>).namespace}/${(cloudInit.secret as Record<string, string>).name}`} mono />
            ) : (
              <InfoRow label="Cloud-Init" value="Auto-detect" />
            )}
            {ssh.publicKey ? (
              <InfoRow label="SSH Key" value="Configured" />
            ) : null}
            <InfoRow label="Root SSH Login" value={ssh.enableRootLogin ? 'Enabled' : 'Disabled'} />
          </Box>
        </Paper>

        {/* Authentication / Root Password */}
        {!!ssh.enableRootLogin && (
          <Paper sx={{ p: 0, overflow: 'hidden' }}>
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                bgcolor: 'rgba(255,255,255,0.02)',
              }}
            >
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                Root Password
              </Typography>
            </Box>
            <Box sx={{ p: 2.5 }}>
              <RootPasswordCopy status={status} />
            </Box>
          </Paper>
        )}

        <Paper sx={{ p: 0, overflow: 'hidden' }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography
              sx={{ fontSize: '0.8125rem', fontWeight: 600 }}
            >
              Status
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <InfoRow label="Phase" value={phase} />
            <InfoRow
              label="Internal IP"
              value={(status.internalIP as string) || 'None'}
              mono
            />
            {status.sshEndpoint ? (
              <InfoRow
                label="SSH Endpoint"
                value={status.sshEndpoint as string}
                mono
              />
            ) : null}
            {status.tunnelEndpoint ? (
              <InfoRow
                label="Tunnel Endpoint"
                value={status.tunnelEndpoint as string}
                mono
              />
            ) : null}
            {status.message ? (
              <InfoRow label="Message" value={status.message as string} />
            ) : null}
          </Box>
        </Paper>
      </Box>

      {/* Conditions */}
      {conditions.length > 0 && (
        <Paper sx={{ mt: 2, p: 0, overflow: 'hidden' }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              bgcolor: 'rgba(255,255,255,0.02)',
            }}
          >
            <Typography
              sx={{ fontSize: '0.8125rem', fontWeight: 600 }}
            >
              Conditions
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Reason</TableCell>
                  <TableCell>Message</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {conditions.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          fontWeight: 500,
                        }}
                      >
                        {c.type}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                        }}
                      >
                        <Box
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            bgcolor:
                              c.status === 'True'
                                ? '#34d399'
                                : '#f87171',
                          }}
                        />
                        <Typography
                          sx={{
                            fontSize: '0.8125rem',
                            color: '#a1a1aa',
                          }}
                        >
                          {c.status}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#a1a1aa',
                        }}
                      >
                        {c.reason}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#71717a',
                        }}
                      >
                        {c.message}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Delete dialog */}
      <Dialog open={showDelete} onClose={() => setShowDelete(false)}>
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
              {name}
            </Box>
            ? This action cannot be undone.
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

const InfoRow: React.FC<{
  label: string;
  value: unknown;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      py: 0.75,
      '&:not(:last-child)': {
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      },
    }}
  >
    <Typography sx={{ fontSize: '0.8125rem', color: '#71717a' }}>
      {label}
    </Typography>
    <Typography
      sx={{
        fontSize: '0.8125rem',
        fontWeight: 500,
        fontFamily: mono ? 'monospace' : 'inherit',
        color: '#d4d4d8',
      }}
    >
      {String(value ?? '-')}
    </Typography>
  </Box>
);
