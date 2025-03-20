import React from 'react';
import { 
  Drawer, 
  Box, 
  Typography, 
  IconButton, 
  Divider,
  useTheme,
  useMediaQuery
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import CloseIcon from '@mui/icons-material/Close';
import FileExplorer from './FileExplorer';

interface FileDrawerProps {
  open: boolean;
  onClose: () => void;
  chatSessionId: string;
}

const FileDrawer: React.FC<FileDrawerProps> = ({ open, onClose, chatSessionId }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  
  const drawerWidth = isMobile ? '100%' : 320;
  
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <FolderIcon sx={{ mr: 1 }} />
          <Typography variant="h6" noWrap>
            Session Files
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          sx={{ color: 'primary.contrastText' }}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </Box>
      
      <Divider />
      
      <Box sx={{ 
        overflow: 'auto', 
        height: '100%', 
        p: 1,
      }}>
        <FileExplorer chatSessionId={chatSessionId} />
      </Box>
    </Drawer>
  );
};

export default FileDrawer; 