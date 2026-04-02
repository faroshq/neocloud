import * as React from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { vmApi, type K8sResource } from './api';

const statusColor: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  Running: 'success',
  Provisioning: 'warning',
  Pending: 'warning',
  Failed: 'error',
  Stopped: 'default',
};

export const VMListPage: React.FC = () => {
  const navigate = useNavigate();
  const [vms, setVms] = React.useState<K8sResource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    vmApi.list()
      .then(setVms)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  if (error) return <Typography color="error">{error}</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5">Virtual Machines</Typography>
        <Button variant="contained" onClick={() => navigate('/console/vm/create')}>
          Create VM
        </Button>
      </Box>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Cores</TableCell>
              <TableCell>Memory</TableCell>
              <TableCell>Image</TableCell>
              <TableCell>GPU</TableCell>
              <TableCell>IP</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {vms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="text.secondary" sx={{ py: 4 }}>
                    No virtual machines found. Create one to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              vms.map((vm) => {
                const spec = (vm.spec || {}) as Record<string, unknown>;
                const status = (vm.status || {}) as Record<string, unknown>;
                const phase = (status.phase as string) || 'Unknown';
                const ips = (status.internalIPs as string[]) || [];
                return (
                  <TableRow
                    key={vm.metadata.name}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/console/vm/${vm.metadata.name}`)}
                  >
                    <TableCell>{vm.metadata.name}</TableCell>
                    <TableCell>
                      <Chip label={phase} size="small" color={statusColor[phase] || 'default'} />
                    </TableCell>
                    <TableCell>{spec.cores as number || '-'}</TableCell>
                    <TableCell>{spec.memory as string || '-'}</TableCell>
                    <TableCell>{spec.image as string || '-'}</TableCell>
                    <TableCell>{spec.gpuCount as number || 0}</TableCell>
                    <TableCell>{ips.join(', ') || '-'}</TableCell>
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
