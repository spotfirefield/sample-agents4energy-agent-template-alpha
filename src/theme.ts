'use client';
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  typography: {
    fontFamily: 'var(--font-roboto)',
  },
  palette: {
    primary: {
      main: '#232F3E', // AWS dark blue/navy
      light: '#31465F',
      dark: '#1A2433',
    },
    secondary: {
      main: '#FF9900', // AWS orange
      light: '#FFAC31',
      dark: '#EC7211',
    },
    background: {
      default: '#F2F3F3', // Light gray background
      paper: '#FFFFFF', // White content areas
    },
    text: {
      primary: '#16191F', // Almost black for primary text
      secondary: '#545B64', // Medium gray for secondary text
    },
    error: {
      main: '#D13212', // AWS red for errors
    },
    info: {
      main: '#0073BB', // AWS blue for info
    },
    success: {
      main: '#1D8102', // AWS green for success
    },
    warning: {
      main: '#FF9900', // AWS orange for warnings
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          textTransform: 'none',
          fontWeight: 500,
          padding: '6px 16px',
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          boxShadow: '0 1px 1px 0 rgba(0, 28, 36, 0.1), 0 1px 3px 1px rgba(0, 28, 36, 0.1)',
          border: '1px solid #eaeded',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#232F3E', // AWS dark blue/navy for header
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: '#F2F3F3',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          color: '#16191F',
        },
      },
    },
  },
});

export default theme;