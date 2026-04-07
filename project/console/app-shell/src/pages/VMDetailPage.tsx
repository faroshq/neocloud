import * as React from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  alpha,
  Tooltip,
  LinearProgress,
  linearProgressClasses,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import DeveloperBoardRoundedIcon from '@mui/icons-material/DeveloperBoardRounded';
import LanRoundedIcon from '@mui/icons-material/LanRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import CloudQueueRoundedIcon from '@mui/icons-material/CloudQueueRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import { useParams, useNavigate } from 'react-router-dom';
import { vmApi, secretApi, type K8sResource } from './api';
import { keyframes } from '@emotion/react';

/* ── animations ─────────────────────────────────────────────── */

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const breathe = keyframes`
  0%, 100% { box-shadow: 0 0 20px var(--glow-color, rgba(129,140,248,0.15)); }
  50%      { box-shadow: 0 0 40px var(--glow-color, rgba(129,140,248,0.3)); }
`;

/* ── status config ──────────────────────────────────────────── */

const statusConfig: Record<string, { color: string; gradient: string; animate: boolean; label: string }> = {
  Running:      { color: '#34d399', gradient: 'linear-gradient(135deg, #34d399, #10b981)', animate: false, label: 'Operational' },
  Provisioning: { color: '#fbbf24', gradient: 'linear-gradient(135deg, #fbbf24, #f59e0b)', animate: true,  label: 'Setting up' },
  Pending:      { color: '#fbbf24', gradient: 'linear-gradient(135deg, #fbbf24, #f59e0b)', animate: true,  label: 'Waiting' },
  Failed:       { color: '#f87171', gradient: 'linear-gradient(135deg, #f87171, #ef4444)', animate: false, label: 'Error' },
  Stopped:      { color: '#52525b', gradient: 'linear-gradient(135deg, #52525b, #3f3f46)', animate: false, label: 'Offline' },
  Terminating:  { color: '#fb923c', gradient: 'linear-gradient(135deg, #fb923c, #f97316)', animate: true,  label: 'Shutting down' },
};

/* ── helpers ────────────────────────────────────────────────── */

function relativeAge(iso: string | undefined): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function parseMemoryMi(mem: unknown): number {
  const s = String(mem || '');
  if (s.endsWith('Gi')) return parseFloat(s) * 1024;
  if (s.endsWith('Mi')) return parseFloat(s);
  if (s.endsWith('G')) return parseFloat(s) * 1024;
  return parseFloat(s) || 0;
}

function parseDiskGi(d: unknown): number {
  const s = String(d || '');
  if (s.endsWith('Ti')) return parseFloat(s) * 1024;
  if (s.endsWith('Gi')) return parseFloat(s);
  if (s.endsWith('G')) return parseFloat(s);
  return parseFloat(s) || 0;
}

/* ── sub-components ─────────────────────────────────────────── */

const ResourceGauge: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  ratio: number; // 0-1
  color: string;
}> = ({ icon, label, value, ratio, color }) => (
  <Box sx={{ flex: 1, minWidth: 140 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
      <Box sx={{ color: alpha(color, 0.7), display: 'flex' }}>{icon}</Box>
      <Typography sx={{ fontSize: '0.6875rem', color: '#71717a', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
    </Box>
    <Typography sx={{ fontSize: '1.125rem', fontWeight: 700, mb: 0.75, color: '#e4e4e7' }}>
      {value}
    </Typography>
    <LinearProgress
      variant="determinate"
      value={Math.min(ratio * 100, 100)}
      sx={{
        height: 4,
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.06)',
        [`& .${linearProgressClasses.bar}`]: {
          borderRadius: 2,
          background: `linear-gradient(90deg, ${alpha(color, 0.6)}, ${color})`,
        },
      }}
    />
  </Box>
);

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
      <Typography sx={{ fontSize: '0.75rem', color: '#52525b', fontStyle: 'italic' }}>
        Awaiting provisioning...
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Tooltip title={copied ? 'Copied!' : 'Copy root password to clipboard'} arrow>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />}
          onClick={handleCopy}
          disabled={loading}
          sx={{
            fontSize: '0.75rem',
            textTransform: 'none',
            py: 0.25,
            px: 1.25,
            minHeight: 0,
            borderColor: copied ? alpha('#22c55e', 0.4) : 'rgba(255,255,255,0.1)',
            color: copied ? '#22c55e' : '#a1a1aa',
            transition: 'all 0.2s ease',
            '&:hover': { borderColor: alpha('#818cf8', 0.4), color: '#818cf8' },
          }}
        >
          {loading ? 'Fetching...' : copied ? 'Copied!' : 'Copy'}
        </Button>
      </Tooltip>
      <Typography sx={{ fontSize: '0.6875rem', color: '#3f3f46', fontFamily: 'monospace' }}>
        {rootPwSecret.namespace}/{rootPwSecret.name}
      </Typography>
      {error && (
        <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>{error}</Typography>
      )}
    </Box>
  );
};

/* ── main page ──────────────────────────────────────────────── */

export const VMDetailPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [vm, setVm] = React.useState<K8sResource | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [showDelete, setShowDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [age, setAge] = React.useState('-');

  // initial fetch + polling
  React.useEffect(() => {
    if (!name) return;
    let cancelled = false;

    const fetchVM = () =>
      vmApi.get(name).then((v) => {
        if (!cancelled) { setVm(v); setError(''); }
      }).catch((e) => {
        if (!cancelled) setError(e.message);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });

    fetchVM();
    const id = setInterval(fetchVM, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [name]);

  // live age ticker
  React.useEffect(() => {
    if (!vm) return;
    const ts = vm.metadata?.creationTimestamp as string | undefined;
    const tick = () => setAge(relativeAge(ts));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [vm]);

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

  /* loading */
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={28} sx={{ color: '#818cf8' }} />
      </Box>
    );
  }

  /* error */
  if (error && !vm) {
    return (
      <Box sx={{ p: 3, borderRadius: 2, bgcolor: alpha('#f87171', 0.08), border: '1px solid', borderColor: alpha('#f87171', 0.2) }}>
        <Typography sx={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</Typography>
      </Box>
    );
  }

  if (!vm) {
    return <Typography color="text.secondary">Virtual machine not found</Typography>;
  }

  const spec = (vm.spec || {}) as Record<string, unknown>;
  const disk = (spec.disk || {}) as Record<string, unknown>;
  const gpu = (spec.gpu || {}) as Record<string, unknown>;
  const ssh = (spec.ssh || {}) as Record<string, unknown>;
  const cloudInit = (spec.cloudInit || {}) as Record<string, unknown>;
  const status = (vm.status || {}) as Record<string, unknown>;
  const phase = (status.phase as string) || 'Unknown';
  const conditions = (status.conditions as Array<Record<string, string>>) || [];
  const config = statusConfig[phase] || { color: '#52525b', gradient: 'linear-gradient(135deg, #52525b, #3f3f46)', animate: false, label: phase };

  const cores = Number(spec.cores || 0);
  const memMi = parseMemoryMi(spec.memory);
  const diskGi = parseDiskGi(disk.size);

  return (
    <Box sx={{ animation: `${fadeInUp} 0.4s ease-out` }}>
      {/* ── back + actions ── */}
      <Box sx={{ mb: 3 }}>
        <Button
          startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={() => navigate('/vm')}
          sx={{ color: '#71717a', fontSize: '0.8125rem', mb: 1.5, px: 0, '&:hover': { color: '#fafafa', bgcolor: 'transparent' } }}
        >
          Virtual Machines
        </Button>
      </Box>

      {/* ── hero status banner ── */}
      <Paper
        sx={{
          p: 0,
          overflow: 'hidden',
          mb: 2.5,
          position: 'relative',
          '--glow-color': alpha(config.color, 0.15),
          animation: config.animate ? `${breathe} 3s ease-in-out infinite` : 'none',
        } as object}
      >
        {/* gradient accent strip */}
        <Box sx={{ height: 3, background: config.gradient }} />
        {/* shimmer overlay for provisioning */}
        {config.animate && (
          <Box sx={{
            position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.04,
            background: `linear-gradient(90deg, transparent 30%, ${config.color} 50%, transparent 70%)`,
            backgroundSize: '200% 100%',
            animation: `${shimmer} 2s linear infinite`,
          }} />
        )}

        <Box sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          {/* name + badge */}
          <Box sx={{ flex: '1 1 auto', minWidth: 200 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{vm.metadata.name}</Typography>
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.375,
                borderRadius: 1.5, bgcolor: alpha(config.color, 0.1), border: '1px solid', borderColor: alpha(config.color, 0.2),
              }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: config.color, animation: config.animate ? `${pulse} 2s ease-in-out infinite` : 'none' }} />
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: config.color }}>{phase}</Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.75rem', color: '#52525b' }}>{config.label}</Typography>
            {status.message && (
              <Typography sx={{ fontSize: '0.75rem', color: '#71717a', mt: 0.5 }}>
                {String(status.message)}
              </Typography>
            )}
          </Box>

          {/* quick stats */}
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {status.internalIP && (
              <Tooltip title="Internal IP" arrow>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <LanRoundedIcon sx={{ fontSize: 14, color: '#52525b' }} />
                  <Typography sx={{ fontSize: '0.8125rem', fontFamily: 'monospace', color: '#a1a1aa' }}>
                    {String(status.internalIP)}
                  </Typography>
                </Box>
              </Tooltip>
            )}
            {status.sshEndpoint && (
              <Tooltip title="SSH Endpoint" arrow>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <TerminalRoundedIcon sx={{ fontSize: 14, color: '#52525b' }} />
                  <Typography sx={{ fontSize: '0.8125rem', fontFamily: 'monospace', color: '#a1a1aa' }}>
                    {String(status.sshEndpoint)}
                  </Typography>
                </Box>
              </Tooltip>
            )}
            <Tooltip title="Age" arrow>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <AccessTimeRoundedIcon sx={{ fontSize: 14, color: '#52525b' }} />
                <Typography sx={{ fontSize: '0.8125rem', fontFamily: 'monospace', color: '#a1a1aa' }}>
                  {age}
                </Typography>
              </Box>
            </Tooltip>
          </Box>

          {/* actions */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<EditRoundedIcon sx={{ fontSize: 15 }} />}
              onClick={() => navigate(`/vm/${name}/edit`)}
              sx={{
                borderColor: 'rgba(255,255,255,0.1)', color: '#a1a1aa',
                transition: 'all 0.2s ease',
                '&:hover': { borderColor: '#818cf8', color: '#818cf8', transform: 'translateY(-1px)' },
              }}
            >
              Edit
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />}
              onClick={() => setShowDelete(true)}
              sx={{
                borderColor: 'rgba(255,255,255,0.1)', color: '#a1a1aa',
                transition: 'all 0.2s ease',
                '&:hover': { borderColor: '#f87171', color: '#f87171', transform: 'translateY(-1px)' },
              }}
            >
              Delete
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* ── resource gauges ── */}
      <Paper sx={{ p: 2.5, mb: 2.5, animation: `${fadeInUp} 0.5s ease-out 0.05s both` }}>
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 2 }}>
          Resources
        </Typography>
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <ResourceGauge
            icon={<DeveloperBoardRoundedIcon sx={{ fontSize: 16 }} />}
            label="CPU"
            value={`${cores} ${cores === 1 ? 'core' : 'cores'}`}
            ratio={Math.min(cores / 16, 1)}
            color="#818cf8"
          />
          <ResourceGauge
            icon={<MemoryRoundedIcon sx={{ fontSize: 16 }} />}
            label="Memory"
            value={String(spec.memory || '-')}
            ratio={Math.min(memMi / (64 * 1024), 1)}
            color="#22d3ee"
          />
          <ResourceGauge
            icon={<StorageRoundedIcon sx={{ fontSize: 16 }} />}
            label="Disk"
            value={String(disk.size || '-')}
            ratio={Math.min(diskGi / 500, 1)}
            color="#34d399"
          />
          {(Number(gpu.count) > 0) && (
            <ResourceGauge
              icon={<DeveloperBoardRoundedIcon sx={{ fontSize: 16 }} />}
              label="GPU"
              value={`${gpu.count}`}
              ratio={Math.min(Number(gpu.count) / 8, 1)}
              color="#fb923c"
            />
          )}
        </Box>
      </Paper>

      {/* ── detail cards ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 2, mb: 2.5, animation: `${fadeInUp} 0.5s ease-out 0.1s both` }}>
        {/* Configuration */}
        <Paper sx={{ p: 0, overflow: 'hidden', transition: 'border-color 0.2s ease', '&:hover': { borderColor: 'rgba(255,255,255,0.12)' } }}>
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid rgba(255,255,255,0.06)', bgcolor: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudQueueRoundedIcon sx={{ fontSize: 14, color: '#52525b' }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>Configuration</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <InfoRow label="Image" value={disk.image} mono />
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

        {/* Access */}
        <Paper sx={{ p: 0, overflow: 'hidden', transition: 'border-color 0.2s ease', '&:hover': { borderColor: 'rgba(255,255,255,0.12)' } }}>
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid rgba(255,255,255,0.06)', bgcolor: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', gap: 1 }}>
            <VpnKeyRoundedIcon sx={{ fontSize: 14, color: '#52525b' }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>Access</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <InfoRow label="Internal IP" value={status.internalIP || 'None'} mono />
            {status.sshEndpoint && <InfoRow label="SSH Endpoint" value={status.sshEndpoint} mono />}
            {status.tunnelEndpoint && <InfoRow label="Tunnel" value={status.tunnelEndpoint} mono />}
            {!!ssh.enableRootLogin && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <Typography sx={{ fontSize: '0.8125rem', color: '#71717a', minWidth: 110, flexShrink: 0 }}>
                  Root Password
                </Typography>
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
                  <RootPasswordCopy status={status} />
                </Box>
              </Box>
            )}
          </Box>
        </Paper>
      </Box>

      {/* ── conditions timeline ── */}
      {conditions.length > 0 && (
        <Paper sx={{ p: 0, overflow: 'hidden', animation: `${fadeInUp} 0.5s ease-out 0.15s both` }}>
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid rgba(255,255,255,0.06)', bgcolor: 'rgba(255,255,255,0.02)' }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>Conditions</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            {conditions.map((c, i) => {
              const ok = c.status === 'True';
              return (
                <Box
                  key={i}
                  sx={{
                    display: 'flex', gap: 2, py: 1.5, position: 'relative',
                    '&:not(:last-child)': { borderBottom: '1px solid rgba(255,255,255,0.04)' },
                    transition: 'background 0.2s ease',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
                    borderRadius: 1, px: 1, mx: -1,
                  }}
                >
                  {/* timeline dot + connector */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.25, minWidth: 24 }}>
                    {ok
                      ? <CheckCircleOutlineRoundedIcon sx={{ fontSize: 16, color: '#34d399' }} />
                      : <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: '#f87171' }} />
                    }
                    {i < conditions.length - 1 && (
                      <Box sx={{ width: 1, flex: 1, bgcolor: 'rgba(255,255,255,0.06)', mt: 0.5 }} />
                    )}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: '#d4d4d8' }}>{c.type}</Typography>
                      <Box sx={{
                        px: 0.75, py: 0.125, borderRadius: 0.75,
                        bgcolor: ok ? alpha('#34d399', 0.1) : alpha('#f87171', 0.1),
                        border: '1px solid',
                        borderColor: ok ? alpha('#34d399', 0.2) : alpha('#f87171', 0.2),
                      }}>
                        <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, color: ok ? '#34d399' : '#f87171' }}>
                          {c.status}
                        </Typography>
                      </Box>
                    </Box>
                    {c.reason && (
                      <Typography sx={{ fontSize: '0.75rem', color: '#71717a' }}>{c.reason}</Typography>
                    )}
                    {c.message && (
                      <Typography sx={{ fontSize: '0.75rem', color: '#52525b', mt: 0.25 }}>{c.message}</Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Paper>
      )}

      {/* ── delete dialog ── */}
      <Dialog open={showDelete} onClose={() => setShowDelete(false)}>
        <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>Delete Virtual Machine</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: '#a1a1aa', fontSize: '0.875rem' }}>
            Are you sure you want to delete{' '}
            <Box component="span" sx={{ fontWeight: 600, color: '#fafafa' }}>{name}</Box>
            ? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setShowDelete(false)} disabled={deleting} sx={{ color: '#a1a1aa' }}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" disabled={deleting} sx={{ bgcolor: '#f87171', '&:hover': { bgcolor: '#ef4444' } }}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

/* ── InfoRow ────────────────────────────────────────────────── */

const InfoRow: React.FC<{ label: string; value: unknown; mono?: boolean }> = ({ label, value, mono }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.75,
    '&:not(:last-child)': { borderBottom: '1px solid rgba(255,255,255,0.04)' },
  }}>
    <Typography sx={{ fontSize: '0.8125rem', color: '#71717a' }}>{label}</Typography>
    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit', color: '#d4d4d8' }}>
      {String(value ?? '-')}
    </Typography>
  </Box>
);
