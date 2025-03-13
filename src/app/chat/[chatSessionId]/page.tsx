"use client"
import React, { useEffect, useState } from 'react';

import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";
import { Box, Typography, Container, Paper, Divider } from '@mui/material';

import ChatBox from "@/components/ChatBox"
import EditableTextBox from '@/components/EditableTextBox';

const amplifyClient = generateClient<Schema>();

function Page({
    params,
}: {
    params: Promise<{ chatSessionId: string }>
}) {
    const [activeChatSession, setActiveChatSession] = useState<Schema["ChatSession"]["createType"]>();

    const setActiveChatSessionAndUpload = async (newChatSession: Schema["ChatSession"]["createType"]) => {
        
        const {data: updatedChatSession} = await amplifyClient.models.ChatSession.update({
            id: (await params).chatSessionId,
            ...newChatSession
        });

        if (updatedChatSession) setActiveChatSession(updatedChatSession);
    }

    //Get the chat session info
    useEffect(() => {
        const fetchChatSession = async () => {
            const chatSessionId = (await params).chatSessionId
            if (chatSessionId) {
                const { data: newChatSessionData } = await amplifyClient.models.ChatSession.get({
                    id: chatSessionId
                });
                // console.log('newGardenData: ', newGardenData)
                if (newChatSessionData) setActiveChatSession(newChatSessionData);
            }
        }
        fetchChatSession()
    }, [params]);

    if (!activeChatSession || !activeChatSession.id) {
        return (
            <Box sx={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                height: '100%'
            }}>
                <Paper elevation={3} sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
                    <Typography variant="h6">Loading your chat session...</Typography>
                </Paper>
            </Box>
        );
    }

    return (
        <Box sx={{ 
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            p: 2
        }}>
            <Paper 
                elevation={3} 
                sx={{ 
                    borderRadius: 2, 
                    overflow: 'hidden',
                    backgroundColor: '#f8f9fa',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%'
                }}
            >
                <Box sx={{ 
                    p: 3, 
                    backgroundColor: '#fff',
                    borderBottom: '1px solid rgba(0,0,0,0.08)'
                }}>
                    <EditableTextBox
                        object={activeChatSession}
                        fieldPath="name"
                        onUpdate={setActiveChatSessionAndUpload}
                        typographyVariant="h3"
                    />
                </Box>
                
                <Divider />
                
                <Box sx={{ 
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    p: 3,
                    backgroundColor: '#f8f9fa',
                    flex: 1
                }}>
                    <ChatBox
                        chatSessionId={activeChatSession.id}
                    />
                </Box>
            </Paper>
        </Box>
    );
}

export default Page;