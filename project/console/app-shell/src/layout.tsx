import * as React from 'react';
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Button,
  ThemeProvider,
  createTheme,
  Divider,
  CircularProgress,
} from '@mui/material';
import type { LayoutProps } from 'piral-core';
import { useNavigate, useLocation } from 'react-router-dom';
import { getEmail, isAuthenticated, signOut, startLogin, handleAuthCallback } from './auth';

const DRAWER_WIDTH = 240;

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#6366f1' },
    background: {
      default: '#0f0f23',
      paper: '#1a1a2e',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
});

const NeoCloudLogo: React.FC = () => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#6366f1" />
      <path d="M8 16L16 8L24 16L16 24Z" fill="white" fillOpacity="0.9" />
      <path d="M12 16L16 12L20 16L16 20Z" fill="#6366f1" />
    </svg>
    <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', letterSpacing: '-0.02em' }}>
      NeoCloud
    </Typography>
  </Box>
);

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [authState, setAuthState] = React.useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');

  // Handle auth callback before anything else.
  // Use window.location for callback detection since React Router may not have parsed the route yet.
  React.useEffect(() => {
    const path = window.location.pathname;
    const search = window.location.search;

    if (path.includes('/auth/callback') && search.includes('response=')) {
      const success = handleAuthCallback();
      if (success) {
        setAuthState('authenticated');
        // Use window.location to do a clean redirect after storing tokens.
        window.location.replace('/console/');
      } else {
        setAuthState('unauthenticated');
      }
      return;
    }

    if (isAuthenticated()) {
      setAuthState('authenticated');
    } else {
      setAuthState('unauthenticated');
    }
  }, []);

  // Show loading while checking auth state.
  if (authState === 'checking') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  // Not authenticated — show login prompt.
  if (authState === 'unauthenticated') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
          <NeoCloudLogo />
          <Typography variant="h5" sx={{ mt: 4, mb: 2 }}>
            Sign in to NeoCloud
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            Authenticate to manage your cloud resources.
          </Typography>
          <Button variant="contained" size="large" onClick={startLogin}>
            Sign in with SSO
          </Button>
        </Box>
      </ThemeProvider>
    );
  }

  const email = getEmail();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'background.paper' }}>
          <Toolbar>
            <Box
              sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              onClick={() => navigate('/')}
            >
              <NeoCloudLogo />
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" sx={{ color: 'grey.400' }}>
                {email}
              </Typography>
              <Button size="small" variant="outlined" color="inherit" onClick={signOut}>
                Sign out
              </Button>
            </Box>
          </Toolbar>
        </AppBar>
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              bgcolor: 'background.paper',
              borderRight: '1px solid rgba(255,255,255,0.08)',
            },
          }}
        >
          <Toolbar />
          <Box sx={{ overflow: 'auto', mt: 1 }}>
            <NavItems navigate={navigate} currentPath={location.pathname} />
          </Box>
        </Drawer>
        <Box component="main" sx={{ flexGrow: 1, p: 3, mt: 8 }}>
          {children}
        </Box>
      </Box>
    </ThemeProvider>
  );
};

interface NavItemsProps {
  navigate: (path: string) => void;
  currentPath: string;
}

const NavItems: React.FC<NavItemsProps> = ({ navigate, currentPath }) => {
  const items = [
    { label: 'Dashboard', path: '/' },
    { label: 'Virtual Machines', path: '/vm' },
    { label: 'Kubernetes Clusters', path: '/kc' },
  ];

  return (
    <List>
      {items.map((item) => (
        <ListItemButton
          key={item.path}
          selected={currentPath === item.path}
          onClick={() => navigate(item.path)}
          sx={{ borderRadius: 1, mx: 1, mb: 0.5 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            <DashboardIcon />
          </ListItemIcon>
          <ListItemText primary={item.label} />
        </ListItemButton>
      ))}
      <Divider sx={{ my: 1 }} />
    </List>
  );
};

const DashboardIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
  </svg>
);
