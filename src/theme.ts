'use client';
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  typography: {
    fontFamily: 'var(--font-roboto)',
  },
  palette: {
    primary: {
      main: '#0063B2', // Deep blue representing technology/AI
    },
    secondary: {
      main: '#00A6A6', // Teal representing innovation
    },
    background: {
      default: '#F5F7FA', // Light gray-blue for a technical feel
      paper: '#FFFFFF', // White Paper
    },
    text: {
      primary: '#1A365D', // Dark blue for primary text
      secondary: '#2D3748', // Dark gray for secondary text
    },
    error: {
      main: '#E53E3E', // Red for errors
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        },
      },
    },
  },
});

export default theme;