import * as React from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import { isAuthenticated, getEmail, startLogin } from './auth';

export const Dashboard: React.FC = () => {
  const authenticated = isAuthenticated();
  const email = getEmail();

  if (!authenticated) {
    return (
      <Box sx={{ textAlign: 'center', mt: 12 }}>
        <Typography variant="h4" gutterBottom>
          Welcome to NeoCloud
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Sign in to manage your cloud resources.
        </Typography>
        <Button variant="contained" size="large" onClick={startLogin}>
          Sign in with SSO
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Welcome back, {email}
      </Typography>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Paper sx={{ p: 3, textAlign: 'center', flex: '1 1 250px' }}>
          <Typography variant="h6">Virtual Machines</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Manage your compute instances
          </Typography>
        </Paper>
        <Paper sx={{ p: 3, textAlign: 'center', flex: '1 1 250px' }}>
          <Typography variant="h6">Kubernetes Clusters</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Manage your Kubernetes clusters
          </Typography>
        </Paper>
        <Paper sx={{ p: 3, textAlign: 'center', flex: '1 1 250px' }}>
          <Typography variant="h6">Settings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Configure your workspace
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
};
