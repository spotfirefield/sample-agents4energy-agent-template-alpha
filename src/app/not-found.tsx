"use client"
import React from 'react';
import { Container, Typography, Button, Box } from '@mui/material';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();
  
  return (
    <Container maxWidth="lg">
      <Box sx={{ textAlign: 'center', my: 5 }}>
        <Typography variant="h2" component="h1" gutterBottom>
          404 - Page Not Found
        </Typography>
        <Typography variant="h5" component="h2" gutterBottom>
          The page you are looking for does not exist.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          size="large"
          sx={{ mt: 3 }}
          onClick={() => router.push('/')}
        >
          Go to Home Page
        </Button>
      </Box>
    </Container>
  );
}
