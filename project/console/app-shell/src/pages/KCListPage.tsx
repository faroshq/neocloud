import * as React from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { kcApi, type K8sResource } from './api';

export const KCListPage: React.FC = () => {
  const navigate = useNavigate();
  const [clusters, setClusters] = React.useState<K8sResource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    kcApi.list()
      .then(setClusters)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  if (error) return <Typography color="error">{error}</Typography>;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>Kubernetes Clusters</Typography>
      <TableContainer component={Paper}>
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
            {clusters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography color="text.secondary" sx={{ py: 4 }}>
                    No Kubernetes clusters found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              clusters.map((kc) => {
                const spec = (kc.spec || {}) as Record<string, unknown>;
                const status = (kc.status || {}) as Record<string, unknown>;
                const conditions = (status.conditions as Array<Record<string, string>>) || [];
                const available = conditions.find((c) => c.type === 'Available');
                const statusLabel = available?.status === 'True' ? 'Available' : 'Pending';
                return (
                  <TableRow
                    key={kc.metadata.name}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/kc/${kc.metadata.name}`)}
                  >
                    <TableCell>{kc.metadata.name}</TableCell>
                    <TableCell>
                      <Chip
                        label={statusLabel} size="small"
                        color={statusLabel === 'Available' ? 'success' : 'warning'}
                      />
                    </TableCell>
                    <TableCell>{spec.version as string || '-'}</TableCell>
                    <TableCell>{spec.nodeCount as number || '-'}</TableCell>
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
