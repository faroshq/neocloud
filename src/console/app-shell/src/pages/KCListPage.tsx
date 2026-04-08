import * as React from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  TextField,
  InputAdornment,
  alpha,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import { useNavigate } from 'react-router-dom';
import { kcApi, type K8sResource } from './api';
import { keyframes } from '@emotion/react';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

export const KCListPage: React.FC = () => {
  const navigate = useNavigate();
  const [clusters, setClusters] = React.useState<K8sResource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    kcApi
      .list()
      .then(setClusters)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = clusters.filter((kc) =>
    kc.metadata.name.toLowerCase().includes(search.toLowerCase()),
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
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5">Kubernetes Clusters</Typography>
        <Typography
          sx={{ fontSize: '0.8125rem', color: '#52525b', mt: 0.25 }}
        >
          {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      <TextField
        placeholder="Search clusters..."
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
              <TableCell>Version</TableCell>
              <TableCell>Nodes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
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
                      <HubRoundedIcon
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
                        ? 'No matching clusters'
                        : 'No Kubernetes clusters found'}
                    </Typography>
                    <Typography
                      sx={{ color: '#3f3f46', fontSize: '0.8125rem' }}
                    >
                      {search
                        ? 'Try a different search term'
                        : 'Clusters will appear here once provisioned'}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((kc) => {
                const spec = (kc.spec || {}) as Record<
                  string,
                  unknown
                >;
                const status = (kc.status || {}) as Record<
                  string,
                  unknown
                >;
                const conditions =
                  (status.conditions as Array<
                    Record<string, string>
                  >) || [];
                const available = conditions.find(
                  (c) => c.type === 'Available',
                );
                const isAvailable =
                  available?.status === 'True';
                const statusLabel = isAvailable
                  ? 'Available'
                  : 'Pending';
                const statusColor = isAvailable
                  ? '#34d399'
                  : '#fbbf24';

                return (
                  <TableRow
                    key={kc.metadata.name}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor:
                          'rgba(255,255,255,0.02) !important',
                      },
                      transition: 'background 0.15s ease',
                    }}
                    onClick={() =>
                      navigate(`/kc/${kc.metadata.name}`)
                    }
                  >
                    <TableCell>
                      <Typography
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.8125rem',
                        }}
                      >
                        {kc.metadata.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                        }}
                      >
                        <Box
                          sx={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            bgcolor: statusColor,
                            boxShadow: `0 0 6px ${alpha(statusColor, 0.4)}`,
                            animation: !isAvailable
                              ? `${pulse} 2s ease-in-out infinite`
                              : 'none',
                          }}
                        />
                        <Typography
                          sx={{
                            fontSize: '0.8125rem',
                            fontWeight: 500,
                            color: statusColor,
                          }}
                        >
                          {statusLabel}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          color: '#a1a1aa',
                          fontFamily: 'monospace',
                        }}
                      >
                        {(spec.version as string) || '-'}
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
                        {(spec.nodeCount as number) || '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
