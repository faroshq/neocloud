import * as React from 'react';
import {
  Box, Typography, Paper, CircularProgress, Chip, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { kcApi, type K8sResource } from './api';

export const KCDetailPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [cluster, setCluster] = React.useState<K8sResource | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!name) return;
    kcApi.get(name)
      .then(setCluster)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  if (error) return <Typography color="error">{error}</Typography>;
  if (!cluster) return <Typography>Cluster not found</Typography>;

  const spec = (cluster.spec || {}) as Record<string, unknown>;
  const status = (cluster.status || {}) as Record<string, unknown>;
  const conditions = (status.conditions as Array<Record<string, string>>) || [];
  const available = conditions.find((c) => c.type === 'Available');
  const statusLabel = available?.status === 'True' ? 'Available' : 'Pending';

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button variant="text" onClick={() => navigate('/kc')}>&larr; Back</Button>
        <Typography variant="h5">{cluster.metadata.name}</Typography>
        <Chip label={statusLabel} color={statusLabel === 'Available' ? 'success' : 'warning'} />
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Paper sx={{ p: 3, flex: '1 1 400px', maxWidth: 500 }}>
          <Typography variant="h6" gutterBottom>Specification</Typography>
          <InfoRow label="Version" value={spec.version} />
          <InfoRow label="Node Count" value={spec.nodeCount} />
        </Paper>
      </Box>

      {conditions.length > 0 && (
        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" gutterBottom>Conditions</Typography>
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
                    <TableCell>{c.type}</TableCell>
                    <TableCell>{c.status}</TableCell>
                    <TableCell>{c.reason}</TableCell>
                    <TableCell>{c.message}</TableCell>
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

const InfoRow: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2">{String(value ?? '-')}</Typography>
  </Box>
);
