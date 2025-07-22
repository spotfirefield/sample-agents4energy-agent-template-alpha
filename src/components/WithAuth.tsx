"use client"
import React, { useEffect } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { redirect } from 'next/navigation';

// export function withAuth<P extends object>(Component: React.ComponentType<P>) {
//   return function AuthProtected(props: P) {
//     const { authStatus } = useAuthenticator(context => [context.authStatus]);

//     useEffect(() => {
//       if (authStatus === 'unauthenticated') {
//         redirect('/auth')
//       }
//     }, [authStatus]);

//     if (authStatus === 'authenticated') {
//       return <Component {...props} />;
//     }

//     return null;
//   };
// }

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
