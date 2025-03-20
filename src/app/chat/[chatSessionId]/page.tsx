"use client"
import React, { useEffect, useState } from 'react';

import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";
import { Box, Typography, Paper, Divider, IconButton, Tooltip } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';

import ChatBox from "@/components/ChatBox"
import EditableTextBox from '@/components/EditableTextBox';
import { withAuth } from '@/components/WithAuth';
import FileDrawer from '@/components/FileDrawer';

const amplifyClient = generateClient<Schema>();

function Page({
    params,
}: {
    params: Promise<{ chatSessionId: string }>
}) {
    const [activeChatSession, setActiveChatSession] = useState<Schema["ChatSession"]["createType"]>();
    const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
    
    const toggleFileDrawer = () => {
        setFileDrawerOpen(!fileDrawerOpen);
    };

    const setActiveChatSessionAndUpload = async (newChatSession: Schema["ChatSession"]["createType"]) => {
        const { data: updatedChatSession } = await amplifyClient.models.ChatSession.update({
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
                if (newChatSessionData) setActiveChatSession({ ...newChatSessionData, name: newChatSessionData.name || "New Chat" });
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
                    borderBottom: '1px solid rgba(0,0,0,0.08)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <EditableTextBox
                        object={activeChatSession}
                        fieldPath="name"
                        onUpdate={setActiveChatSessionAndUpload}
                        typographyVariant="h3"
                    />
                    <Tooltip title="View Files">
                        <IconButton 
                            onClick={toggleFileDrawer}
                            color="primary"
                            size="large"
                        >
                            <FolderIcon />
                        </IconButton>
                    </Tooltip>
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
            
            {/* File Drawer */}
            <FileDrawer 
                open={fileDrawerOpen} 
                onClose={() => setFileDrawerOpen(false)} 
                chatSessionId={activeChatSession.id} 
            />
        </Box>
    );
}

export default withAuth(Page);