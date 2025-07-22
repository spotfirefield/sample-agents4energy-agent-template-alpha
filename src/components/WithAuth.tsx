"use client"
import React, { useEffect } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { redirect } from 'next/navigation';

interface WithAuthProps {
  children: React.ReactNode;
}

const WithAuth: React.FC<WithAuthProps> = ({ children }) => {
  return (
    <Authenticator>
      {children}
    </Authenticator>
  )
};

export default WithAuth;

export function addAuthToPage<P extends object>(Component: React.ComponentType<P>) {
  return function AuthProtected(props: P) {
    const { authStatus } = useAuthenticator(context => [context.authStatus]);

    useEffect(() => {
      if (authStatus === 'unauthenticated') {
        redirect('/auth')
      }
    }, [authStatus]);

    if (authStatus === 'authenticated') {
      return <Component {...props} />;
    }

    return null;
  };
}