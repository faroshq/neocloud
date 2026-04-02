import * as React from 'react';
import {
  Box, Typography, Paper, CircularProgress, Chip, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { vmApi, type K8sResource } from './api';

export const VMDetailPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [vm, setVm] = React.useState<K8sResource | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!name) return;
    vmApi.get(name)
      .then(setVm)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  if (error) return <Typography color="error">{error}</Typography>;
  if (!vm) return <Typography>VM not found</Typography>;

  const spec = (vm.spec || {}) as Record<string, unknown>;
  const status = (vm.status || {}) as Record<string, unknown>;
  const phase = (status.phase as string) || 'Unknown';
  const conditions = (status.conditions as Array<Record<string, string>>) || [];
  const ips = (status.internalIPs as string[]) || [];
  const endpoints = (status.endpoints as Record<string, string>) || {};

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button variant="text" onClick={() => navigate('/vm')}>&larr; Back</Button>
        <Typography variant="h5">{vm.metadata.name}</Typography>
        <Chip label={phase} color={phase === 'Running' ? 'success' : phase === 'Failed' ? 'error' : 'warning'} />
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Paper sx={{ p: 3, flex: '1 1 400px' }}>
          <Typography variant="h6" gutterBottom>Specification</Typography>
          <InfoRow label="CPU Cores" value={spec.cores} />
          <InfoRow label="Memory" value={spec.memory} />
          <InfoRow label="Disk Size" value={spec.diskSize} />
          <InfoRow label="Image" value={spec.image} />
          <InfoRow label="GPU Count" value={spec.gpuCount || 0} />
          {spec.sshPublicKey && <InfoRow label="SSH Key" value="Configured" />}
        </Paper>
        <Paper sx={{ p: 3, flex: '1 1 400px' }}>
          <Typography variant="h6" gutterBottom>Status</Typography>
          <InfoRow label="Phase" value={phase} />
          <InfoRow label="Internal IPs" value={ips.join(', ') || 'None'} />
          {Object.entries(endpoints).map(([k, v]) => (
            <InfoRow key={k} label={k} value={v} />
          ))}
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
