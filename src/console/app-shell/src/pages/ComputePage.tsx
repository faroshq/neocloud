import * as React from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { VMListPage } from './VMListPage';
import { CloudInitListPage } from './CloudInitListPage';

export const ComputePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'cloudinit' ? 1 : 0;

  const handleChange = (_: React.SyntheticEvent, newValue: number) => {
    setSearchParams(newValue === 0 ? {} : { tab: 'cloudinit' });
  };

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'rgba(255,255,255,0.06)', mb: 3 }}>
        <Tabs
          value={tab}
          onChange={handleChange}
          sx={{
            minHeight: 36,
            '& .MuiTab-root': {
              minHeight: 36,
              textTransform: 'none',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: '#71717a',
              px: 2,
              '&.Mui-selected': { color: '#818cf8' },
            },
            '& .MuiTabs-indicator': {
              bgcolor: '#818cf8',
              height: 2,
              borderRadius: '2px 2px 0 0',
            },
          }}
        >
          <Tab label="Virtual Machines" />
          <Tab label="Cloud Init" />
        </Tabs>
      </Box>
      {tab === 0 && <VMListPage />}
      {tab === 1 && <CloudInitListPage />}
    </Box>
  );
};
