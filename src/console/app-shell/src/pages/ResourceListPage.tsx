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
import { useNavigate } from 'react-router-dom';
import { resourceApi, type K8sResource } from './api';
import { type ResourceDef, getNestedValue } from '../resources';
import { keyframes } from '@emotion/react';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

interface ResourceListPageProps {
  group: string;
  version: string;
  resource: ResourceDef;
}

export const ResourceListPage: React.FC<ResourceListPageProps> = ({
  group,
  version,
  resource,
}) => {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<K8sResource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');

  const api = React.useMemo(
    () => resourceApi(group, version, resource.plural),
    [group, version, resource.plural],
  );

  React.useEffect(() => {
    setLoading(true);
    setError('');
    api
      .list()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [api]);

  const filtered = items.filter((item) =>
    item.metadata.name.toLowerCase().includes(search.toLowerCase()),
  );

  const Icon = resource.icon;

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
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5">{resource.displayNamePlural}</Typography>
        <Typography
          sx={{ fontSize: '0.6875rem', color: '#52525b', mt: 0.25 }}
        >
          {items.length} {items.length === 1 ? resource.displayName.toLowerCase() : resource.displayNamePlural.toLowerCase()}
        </Typography>
      </Box>

      <TextField
        placeholder={`Search ${resource.displayNamePlural.toLowerCase()}...`}
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 1.5, maxWidth: 280 }}
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon
                  sx={{ fontSize: 14, color: '#52525b' }}
                />
              </InputAdornment>
            ),
          },
        }}
      />

      <TableContainer component={Paper} sx={{ borderRadius: 1.5 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              {resource.columns.map((col) => (
                <TableCell key={col.header}>{col.header}</TableCell>
              ))}
              <TableCell>Age</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3 + resource.columns.length} align="center">
                  <Box sx={{ py: 5, px: 3 }}>
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: 2,
                        bgcolor: 'rgba(255,255,255,0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto',
                        mb: 1.5,
                      }}
                    >
                      <Icon sx={{ fontSize: 22, color: '#3f3f46' }} />
                    </Box>
                    <Typography
                      sx={{
                        color: '#71717a',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        mb: 0.25,
                      }}
                    >
                      {search
                        ? `No matching ${resource.displayNamePlural.toLowerCase()}`
                        : `No ${resource.displayNamePlural.toLowerCase()} found`}
                    </Typography>
                    <Typography
                      sx={{ color: '#3f3f46', fontSize: '0.6875rem' }}
                    >
                      {search
                        ? 'Try a different search term'
                        : `${resource.displayNamePlural} will appear here once created`}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => {
                const { label: statusLabel, color: statusColor } =
                  resource.statusExtractor(item as unknown as Record<string, unknown>);

                return (
                  <TableRow
                    key={item.metadata.name}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.02) !important',
                      },
                      transition: 'background 0.15s ease',
                    }}
                    onClick={() =>
                      navigate(`${resource.path}/${item.metadata.name}`)
                    }
                  >
                    <TableCell>
                      <Typography
                        sx={{ fontWeight: 600, fontSize: '0.6875rem' }}
                      >
                        {item.metadata.name}
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
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            bgcolor: statusColor,
                            boxShadow: `0 0 6px ${alpha(statusColor, 0.4)}`,
                            animation:
                              statusLabel === 'Pending' || statusLabel === 'Provisioning'
                                ? `${pulse} 2s ease-in-out infinite`
                                : 'none',
                          }}
                        />
                        <Typography
                          sx={{
                            fontSize: '0.6875rem',
                            fontWeight: 500,
                            color: statusColor,
                          }}
                        >
                          {statusLabel}
                        </Typography>
                      </Box>
                    </TableCell>
                    {resource.columns.map((col) => (
                      <TableCell key={col.header}>
                        <Typography
                          sx={{
                            fontSize: '0.6875rem',
                            color: '#a1a1aa',
                            fontFamily: col.mono ? 'monospace' : 'inherit',
                          }}
                        >
                          {String(
                            getNestedValue(
                              item as unknown as Record<string, unknown>,
                              col.field,
                            ) ?? '-',
                          )}
                        </Typography>
                      </TableCell>
                    ))}
                    <TableCell>
                      <Typography
                        sx={{
                          fontSize: '0.6875rem',
                          color: '#71717a',
                        }}
                      >
                        {formatAge(item.metadata.creationTimestamp)}
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

function formatAge(timestamp?: string): string {
  if (!timestamp) return '-';
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
