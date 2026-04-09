import * as React from 'react';
import {
  Box,
  CssBaseline,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Button,
  ThemeProvider,
  createTheme,
  Avatar,
  IconButton,
  CircularProgress,
  alpha,
} from '@mui/material';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import type { LayoutProps } from 'piral-core';
import type { SvgIconComponent } from './resources';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getEmail,
  isAuthenticated,
  signOut,
  startLogin,
  handleAuthCallback,
} from './auth';
import { discoverApiGroups } from './api';
import { apiGroups } from './resources';

const DRAWER_WIDTH = 232;

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#818cf8' },
    secondary: { main: '#22d3ee' },
    success: { main: '#34d399' },
    warning: { main: '#fbbf24' },
    error: { main: '#f87171' },
    background: {
      default: '#09090b',
      paper: '#111113',
    },
    text: {
      primary: '#fafafa',
      secondary: '#a1a1aa',
    },
    divider: 'rgba(255,255,255,0.06)',
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.025em' },
    h5: { fontWeight: 650, letterSpacing: '-0.02em' },
    h6: { fontWeight: 600, letterSpacing: '-0.01em' },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 600,
          borderRadius: 8,
          fontSize: '0.8125rem',
        },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(255,255,255,0.06)',
          padding: '12px 16px',
        },
        head: {
          fontWeight: 600,
          color: '#71717a',
          fontSize: '0.6875rem',
          letterSpacing: '0.05em',
          textTransform: 'uppercase' as const,
          background: 'rgba(255,255,255,0.02)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
            '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.08)',
          backgroundImage: 'none',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          fontSize: '0.75rem',
          borderRadius: 6,
        },
      },
    },
  },
});

const GradientBar: React.FC = () => (
  <Box
    sx={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      zIndex: 9999,
      background: 'linear-gradient(90deg, #818cf8, #22d3ee, #34d399, #818cf8)',
      backgroundSize: '200% 100%',
      animation: 'gradientShift 8s ease infinite',
      '@keyframes gradientShift': {
        '0%': { backgroundPosition: '0% 0%' },
        '50%': { backgroundPosition: '100% 0%' },
        '100%': { backgroundPosition: '0% 0%' },
      },
    }}
  />
);

const NeoCloudLogo: React.FC = () => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logoGrad)" />
      <path
        d="M16 7L25 16L16 25L7 16Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path
        d="M16 12L20 16L16 20L12 16Z"
        fill="url(#logoGrad)"
      />
    </svg>
    <Typography
      sx={{
        fontWeight: 700,
        fontSize: '1.05rem',
        color: '#fafafa',
        letterSpacing: '-0.02em',
      }}
    >
      NeoCloud
    </Typography>
  </Box>
);

interface NavItem {
  label: string;
  path: string;
  icon: SvgIconComponent;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

/** Build navigation sections from discovered API groups */
function useNavSections(): NavSection[] {
  const [availableGroups, setAvailableGroups] = React.useState<Set<string> | null>(null);

  React.useEffect(() => {
    if (!isAuthenticated()) return;
    discoverApiGroups()
      .then((groups) => {
        const names = new Set(groups.map((g) => g.name));
        setAvailableGroups(names);
      })
      .catch(() => {
        // Fallback: show all groups if discovery fails
        setAvailableGroups(null);
      });
  }, []);

  const sections: NavSection[] = [
    {
      label: 'Overview',
      items: [{ label: 'Dashboard', path: '/', icon: GridViewRoundedIcon }],
    },
  ];

  for (const group of apiGroups) {
    // If discovery succeeded, only show groups that have APIBindings
    if (availableGroups !== null && !availableGroups.has(group.group)) {
      continue;
    }
    sections.push({
      label: group.label,
      items: group.resources.map((r) => ({
        label: r.displayNamePlural,
        path: r.path,
        icon: r.icon,
      })),
    });
  }

  return sections;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const navSections = useNavSections();
  const [authState, setAuthState] = React.useState<
    'checking' | 'authenticated' | 'unauthenticated'
  >('checking');

  React.useEffect(() => {
    const path = window.location.pathname;
    const search = window.location.search;
    if (path.includes('/auth/callback') && search.includes('response=')) {
      const success = handleAuthCallback();
      if (success) {
        setAuthState('authenticated');
        window.location.replace('/console/');
      } else {
        setAuthState('unauthenticated');
      }
      return;
    }
    setAuthState(isAuthenticated() ? 'authenticated' : 'unauthenticated');
  }, []);

  if (authState === 'checking') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            bgcolor: 'background.default',
          }}
        >
          <CircularProgress size={28} sx={{ color: '#818cf8' }} />
        </Box>
      </ThemeProvider>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GradientBar />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            bgcolor: 'background.default',
          }}
        >
          <Box
            sx={{
              p: 5,
              borderRadius: 3,
              textAlign: 'center',
              border: '1px solid rgba(255,255,255,0.08)',
              bgcolor: '#0e0e11',
              maxWidth: 380,
              width: '100%',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
              <NeoCloudLogo />
            </Box>
            <Typography
              variant="h5"
              sx={{ mb: 1, fontSize: '1.25rem' }}
            >
              Welcome back
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 4, lineHeight: 1.6 }}
            >
              Sign in to manage your cloud infrastructure
            </Typography>
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={startLogin}
              sx={{
                py: 1.4,
                fontSize: '0.875rem',
                background: 'linear-gradient(135deg, #818cf8, #6366f1)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
                },
              }}
            >
              Sign in with SSO
            </Button>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  const email = getEmail();
  const initials = email ? email.substring(0, 2).toUpperCase() : 'NC';

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GradientBar />
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              bgcolor: '#0c0c0e',
              borderRight: '1px solid rgba(255,255,255,0.06)',
              pt: '2px',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <Box
            sx={{
              px: 2.5,
              py: 2.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            onClick={() => navigate('/')}
          >
            <NeoCloudLogo />
          </Box>

          <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, mt: 0.5 }}>
            {navSections.map((section, idx) => (
              <React.Fragment key={section.label}>
                {idx > 0 && <Box sx={{ my: 1.5 }} />}
                <Typography
                  sx={{
                    px: 1,
                    mb: 0.5,
                    color: '#3f3f46',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  {section.label}
                </Typography>
                <List dense disablePadding>
                  {section.items.map((item) => {
                    const active = isActive(item.path);
                    const Icon = item.icon;
                    return (
                      <ListItemButton
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        sx={{
                          borderRadius: '8px',
                          mb: 0.25,
                          py: 0.875,
                          px: 1.25,
                          position: 'relative',
                          bgcolor: active
                            ? alpha('#818cf8', 0.1)
                            : 'transparent',
                          color: active ? '#818cf8' : '#71717a',
                          '&:hover': {
                            bgcolor: active
                              ? alpha('#818cf8', 0.12)
                              : 'rgba(255,255,255,0.04)',
                            color: active ? '#818cf8' : '#e4e4e7',
                          },
                          '&::before': active
                            ? {
                                content: '""',
                                position: 'absolute',
                                left: 0,
                                top: '25%',
                                bottom: '25%',
                                width: 3,
                                borderRadius: '0 2px 2px 0',
                                bgcolor: '#818cf8',
                              }
                            : {},
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <ListItemIcon
                          sx={{ minWidth: 30, color: 'inherit' }}
                        >
                          <Icon sx={{ fontSize: 18 }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={item.label}
                          primaryTypographyProps={{
                            fontSize: '0.8125rem',
                            fontWeight: active ? 600 : 500,
                          }}
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              </React.Fragment>
            ))}
          </Box>

          <Box
            sx={{
              p: 1.5,
              mx: 1.5,
              mb: 1.5,
              borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
            }}
          >
            <Avatar
              sx={{
                width: 30,
                height: 30,
                fontSize: '0.65rem',
                fontWeight: 700,
                bgcolor: alpha('#818cf8', 0.15),
                color: '#818cf8',
              }}
            >
              {initials}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: '#d4d4d8',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {email}
              </Typography>
            </Box>
            <IconButton
              size="small"
              onClick={signOut}
              sx={{
                color: '#52525b',
                p: 0.5,
                '&:hover': { color: '#f87171', bgcolor: alpha('#f87171', 0.1) },
              }}
            >
              <LogoutRoundedIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>
        </Drawer>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 4,
            pt: 3.5,
            mt: '2px',
            minHeight: '100vh',
            bgcolor: 'background.default',
            maxWidth: `calc(100vw - ${DRAWER_WIDTH}px)`,
          }}
        >
          {children}
        </Box>
      </Box>
    </ThemeProvider>
  );
};
