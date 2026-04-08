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
  alpha,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useParams, useNavigate } from 'react-router-dom';
import { kcApi, type K8sResource } from './api';
import { keyframes } from '@emotion/react';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

export const KCDetailPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [cluster, setCluster] = React.useState<K8sResource | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!name) return;
    kcApi
      .get(name)
      .then(setCluster)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [name]);

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

  if (!cluster) {
    return (
      <Typography color="text.secondary">Cluster not found</Typography>
    );
  }

  const spec = (cluster.spec || {}) as Record<string, unknown>;
  const status = (cluster.status || {}) as Record<string, unknown>;
  const conditions =
    (status.conditions as Array<Record<string, string>>) || [];
  const available = conditions.find((c) => c.type === 'Available');
  const isAvailable = available?.status === 'True';
  const statusLabel = isAvailable ? 'Available' : 'Pending';
  const statusColor = isAvailable ? '#34d399' : '#fbbf24';

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Button
          startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={() => navigate('/kc')}
          sx={{
            color: '#71717a',
            fontSize: '0.8125rem',
            mb: 1.5,
            px: 0,
            '&:hover': { color: '#fafafa', bgcolor: 'transparent' },
          }}
        >
          Kubernetes Clusters
        </Button>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h5">{cluster.metadata.name}</Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1.25,
              py: 0.375,
              borderRadius: 1.5,
              bgcolor: alpha(statusColor, 0.1),
              border: '1px solid',
              borderColor: alpha(statusColor, 0.2),
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: statusColor,
                animation: !isAvailable
                  ? `${pulse} 2s ease-in-out infinite`
                  : 'none',
              }}
            />
            <Typography
              sx={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: statusColor,
              }}
            >
              {statusLabel}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Specification */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
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
            <InfoRow label="Version" value={spec.version} mono />
            <InfoRow label="Node Count" value={spec.nodeCount} mono />
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
