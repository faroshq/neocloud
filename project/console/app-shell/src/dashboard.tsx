import * as React from 'react';
import { Box, Typography, Paper, Button, Skeleton, alpha } from '@mui/material';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated, getEmail, startLogin } from './auth';
import { vmApi, kcApi, type K8sResource } from './api';

interface StatCardProps {
  title: string;
  count: number | null;
  subtitle: string;
  icon: React.ReactNode;
  gradient: string;
  accentColor: string;
  onClick: () => void;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  count,
  subtitle,
  icon,
  gradient,
  accentColor,
  onClick,
}) => (
  <Paper
    onClick={onClick}
    sx={{
      p: 2.5,
      flex: '1 1 220px',
      cursor: 'pointer',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.2s ease',
      '&:hover': {
        borderColor: alpha(accentColor, 0.3),
        transform: 'translateY(-2px)',
        boxShadow: `0 8px 32px ${alpha(accentColor, 0.1)}`,
      },
    }}
  >
    <Box
      sx={{
        position: 'absolute',
        top: -20,
        right: -20,
        width: 80,
        height: 80,
        borderRadius: '50%',
        background: gradient,
        opacity: 0.08,
      }}
    />
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        mb: 2,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: gradient,
          opacity: 0.9,
        }}
      >
        {icon}
      </Box>
      <Typography
        sx={{ fontSize: '0.8125rem', fontWeight: 500, color: '#a1a1aa' }}
      >
        {title}
      </Typography>
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      {count === null ? (
        <Skeleton width={48} height={40} />
      ) : (
        <Typography
          sx={{
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {count}
        </Typography>
      )}
      <Typography sx={{ fontSize: '0.75rem', color: '#52525b' }}>
        {subtitle}
      </Typography>
    </Box>
  </Paper>
);

interface QuickActionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}

const QuickAction: React.FC<QuickActionProps> = ({
  title,
  description,
  icon,
  onClick,
}) => (
  <Box
    onClick={onClick}
    sx={{
      p: 2,
      borderRadius: 2,
      border: '1px solid rgba(255,255,255,0.06)',
      bgcolor: 'rgba(255,255,255,0.02)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      transition: 'all 0.2s ease',
      '&:hover': {
        borderColor: 'rgba(255,255,255,0.12)',
        bgcolor: 'rgba(255,255,255,0.04)',
        '& .arrow': { opacity: 1, transform: 'translateX(0)' },
      },
    }}
  >
    <Box
      sx={{
        width: 36,
        height: 36,
        borderRadius: 1.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(255,255,255,0.06)',
        color: '#a1a1aa',
      }}
    >
      {icon}
    </Box>
    <Box sx={{ flex: 1 }}>
      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography sx={{ fontSize: '0.75rem', color: '#52525b' }}>
        {description}
      </Typography>
    </Box>
    <ArrowForwardRoundedIcon
      className="arrow"
      sx={{
        fontSize: 16,
        color: '#52525b',
        opacity: 0,
        transform: 'translateX(-4px)',
        transition: 'all 0.2s ease',
      }}
    />
  </Box>
);

export const Dashboard: React.FC = () => {
  const authenticated = isAuthenticated();
  const email = getEmail();
  const navigate = useNavigate();

  const [vmCount, setVmCount] = React.useState<number | null>(null);
  const [runningVms, setRunningVms] = React.useState(0);
  const [kcCount, setKcCount] = React.useState<number | null>(null);
  const [availableKc, setAvailableKc] = React.useState(0);

  React.useEffect(() => {
    if (!authenticated) return;
    vmApi
      .list()
      .then((vms: K8sResource[]) => {
        setVmCount(vms.length);
        setRunningVms(
          vms.filter(
            (v) =>
              ((v.status || {}) as Record<string, unknown>).phase === 'Running',
          ).length,
        );
      })
      .catch(() => setVmCount(0));

    kcApi
      .list()
      .then((clusters: K8sResource[]) => {
        setKcCount(clusters.length);
        setAvailableKc(
          clusters.filter((c) => {
            const status = (c.status || {}) as Record<string, unknown>;
            const conditions =
              (status.conditions as Array<Record<string, string>>) || [];
            return conditions.some(
              (cond) => cond.type === 'Available' && cond.status === 'True',
            );
          }).length,
        );
      })
      .catch(() => setKcCount(0));
  }, [authenticated]);

  if (!authenticated) {
    return (
      <Box sx={{ textAlign: 'center', mt: 16 }}>
        <Typography variant="h4" gutterBottom>
          Welcome to NeoCloud
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ mb: 4 }}
        >
          Sign in to manage your cloud resources.
        </Typography>
        <Button
          variant="contained"
          size="large"
          onClick={startLogin}
          sx={{
            px: 4,
            py: 1.5,
            background: 'linear-gradient(135deg, #818cf8, #6366f1)',
            '&:hover': {
              background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
            },
          }}
        >
          Sign in with SSO
        </Button>
      </Box>
    );
  }

  const firstName = email?.split('@')[0] || 'there';
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? 'Good morning'
      : hour < 18
        ? 'Good afternoon'
        : 'Good evening';

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography
          sx={{
            fontSize: '0.8125rem',
            color: '#52525b',
            fontWeight: 500,
            mb: 0.5,
          }}
        >
          {greeting}
        </Typography>
        <Typography variant="h4">
          Welcome back, {firstName}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 4 }}>
        <StatCard
          title="Virtual Machines"
          count={vmCount}
          subtitle={
            vmCount !== null
              ? `${runningVms} running`
              : ''
          }
          icon={
            <DnsRoundedIcon sx={{ fontSize: 18, color: 'white' }} />
          }
          gradient="linear-gradient(135deg, #818cf8, #6366f1)"
          accentColor="#818cf8"
          onClick={() => navigate('/vm')}
        />
        <StatCard
          title="Kubernetes Clusters"
          count={kcCount}
          subtitle={
            kcCount !== null
              ? `${availableKc} available`
              : ''
          }
          icon={
            <HubRoundedIcon sx={{ fontSize: 18, color: 'white' }} />
          }
          gradient="linear-gradient(135deg, #22d3ee, #06b6d4)"
          accentColor="#22d3ee"
          onClick={() => navigate('/kc')}
        />
        <StatCard
          title="Healthy Resources"
          count={
            vmCount !== null && kcCount !== null
              ? runningVms + availableKc
              : null
          }
          subtitle="across all types"
          icon={
            <CheckCircleRoundedIcon
              sx={{ fontSize: 18, color: 'white' }}
            />
          }
          gradient="linear-gradient(135deg, #34d399, #10b981)"
          accentColor="#34d399"
          onClick={() => {}}
        />
      </Box>

      <Typography
        sx={{
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: '#71717a',
          mb: 1.5,
          letterSpacing: '0.02em',
        }}
      >
        Quick actions
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 1.5,
        }}
      >
        <QuickAction
          title="Create Virtual Machine"
          description="Launch a new compute instance"
          icon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={() => navigate('/vm/create')}
        />
        <QuickAction
          title="View Virtual Machines"
          description="Manage existing compute instances"
          icon={<DnsRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={() => navigate('/vm')}
        />
        <QuickAction
          title="View Kubernetes Clusters"
          description="Manage container orchestration"
          icon={<HubRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={() => navigate('/kc')}
        />
      </Box>
    </Box>
  );
};
