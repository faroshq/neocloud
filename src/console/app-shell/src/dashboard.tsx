import * as React from 'react';
import { Box, Typography, Paper, Button, Skeleton, alpha } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated, getEmail, startLogin } from './auth';
import { resourceApi, type K8sResource } from './api';
import { apiGroups } from './resources';

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
      p: 1.75,
      flex: '1 1 180px',
      minWidth: 160,
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
        gap: 1,
        mb: 1.25,
      }}
    >
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: 1,
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
        sx={{ fontSize: '0.6875rem', fontWeight: 500, color: '#a1a1aa' }}
      >
        {title}
      </Typography>
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
      {count === null ? (
        <Skeleton width={36} height={28} />
      ) : (
        <Typography
          sx={{
            fontSize: '1.5rem',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {count}
        </Typography>
      )}
      <Typography sx={{ fontSize: '0.625rem', color: '#52525b' }}>
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
      p: 1.25,
      borderRadius: 1.5,
      border: '1px solid rgba(255,255,255,0.06)',
      bgcolor: 'rgba(255,255,255,0.02)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 1.25,
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
        width: 26,
        height: 26,
        borderRadius: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(255,255,255,0.06)',
        color: '#a1a1aa',
      }}
    >
      {icon}
    </Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography sx={{ fontSize: '0.625rem', color: '#52525b' }}>
        {description}
      </Typography>
    </Box>
    <ArrowForwardRoundedIcon
      className="arrow"
      sx={{
        fontSize: 14,
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

  const [counts, setCounts] = React.useState<Map<string, number>>(new Map());

  React.useEffect(() => {
    if (!authenticated) return;

    // Fetch counts for each resource independently so the dashboard
    // populates progressively and doesn't block on missing API groups
    for (const group of apiGroups) {
      for (const resource of group.resources) {
        const key = `${group.group}/${resource.plural}`;
        resourceApi(group.group, group.version, resource.plural)
          .list()
          .then((items: K8sResource[]) => {
            setCounts((prev) => new Map(prev).set(key, items.length));
          })
          .catch(() => {
            // API group not available — show 0 instead of skeleton
            setCounts((prev) => new Map(prev).set(key, 0));
          });
      }
    }
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

  function getCount(groupName: string, plural: string): number | null {
    const key = `${groupName}/${plural}`;
    return counts.has(key) ? counts.get(key)! : null;
  }

  return (
    <Box>
      <Box sx={{ mb: 2.5 }}>
        <Typography
          sx={{
            fontSize: '0.625rem',
            color: '#52525b',
            fontWeight: 500,
            mb: 0.25,
          }}
        >
          {greeting}
        </Typography>
        <Typography variant="h4">
          Welcome back, {firstName}
        </Typography>
      </Box>

      {/* Stat cards grouped by API group */}
      {apiGroups.map((group) => (
        <Box key={group.group} sx={{ mb: 2.5 }}>
          <Typography
            sx={{
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#3f3f46',
              mb: 1,
            }}
          >
            {group.label}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
            {group.resources.map((resource) => {
              const Icon = resource.icon;
              const count = getCount(group.group, resource.plural);
              return (
                <StatCard
                  key={resource.plural}
                  title={resource.displayNamePlural}
                  count={count}
                  subtitle={count !== null ? 'total' : ''}
                  icon={<Icon sx={{ fontSize: 15, color: 'white' }} />}
                  gradient={group.gradient}
                  accentColor={group.accentColor}
                  onClick={() => navigate(resource.path)}
                />
              );
            })}
          </Box>
        </Box>
      ))}

      {/* Quick actions */}
      <Typography
        sx={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: '#71717a',
          mb: 1,
          letterSpacing: '0.02em',
        }}
      >
        Quick actions
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 1,
        }}
      >
        <QuickAction
          title="Create Virtual Machine"
          description="Launch a new compute instance"
          icon={<AddRoundedIcon sx={{ fontSize: 15 }} />}
          onClick={() => navigate('/vm/create')}
        />
        {apiGroups.map((group) =>
          group.resources.map((resource) => {
            const Icon = resource.icon;
            return (
              <QuickAction
                key={resource.plural}
                title={`View ${resource.displayNamePlural}`}
                description={`Manage ${resource.displayNamePlural.toLowerCase()}`}
                icon={<Icon sx={{ fontSize: 15 }} />}
                onClick={() => navigate(resource.path)}
              />
            );
          }),
        )}
      </Box>
    </Box>
  );
};
