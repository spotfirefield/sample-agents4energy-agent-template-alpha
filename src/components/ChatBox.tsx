import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, TextField, Button, List, ListItem, Typography, CircularProgress } from '@mui/material';


import { combineAndSortMessages, sendMessage } from '../../utils/amplifyUtils';
import { Message } from '../../utils/types';

import ChatMessage from './ChatMessage';

import { defaultPrompts } from '@/constants/defaultPrompts';

import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";
const amplifyClient = generateClient<Schema>();

const ChatBox = (params: {
  chatSessionId: string,
}) => {

  const [messages, setMessages] = useState<Message[]>([]);
  const [, setResponseStreamChunks] = useState<(Schema["recieveResponseStreamChunk"]["returnType"] | null)[]>([]);
  const [streamChunkMessage, setStreamChunkMessage] = useState<Message>();
  const [userInput, setUserInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const messagesPerPage = 20;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  //Subscribe to the chat messages for the garden
  useEffect(() => {
    const messageSubscriptionHandler = async () => {
      console.log('Creating message subscription for garden: ', params.chatSessionId)
      const messagesSub = amplifyClient.models.ChatMessage.observeQuery({
        filter: {
          chatSessionId: { eq: params.chatSessionId }
        }
      }).subscribe({
        next: ({ items }) => {
          setMessages((prevMessages) => {
            // Only take the most recent messagesPerPage messages
            const recentMessages = items.slice(-messagesPerPage);
            const sortedMessages = combineAndSortMessages(prevMessages, recentMessages)
            if (sortedMessages[sortedMessages.length - 1] && sortedMessages[sortedMessages.length - 1].responseComplete) {
              setIsLoading(false)
            }
            setHasMoreMessages(items.length > messagesPerPage);
            return sortedMessages
          })
          setStreamChunkMessage(undefined)
          setResponseStreamChunks([])
        }
      })

      return () => {
        messagesSub.unsubscribe();
      };
    }

    messageSubscriptionHandler()
  }, [params.chatSessionId])

  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !hasMoreMessages) return;
    
    setIsLoadingMore(true);
    const nextPage = page + 1;
    
    try {
      const result = await amplifyClient.models.ChatMessage.list({
        filter: {
          chatSessionId: { eq: params.chatSessionId }
        }
      });
      
      if (result.data) {
        // Get the next page of messages
        const startIndex = (nextPage - 1) * messagesPerPage;
        const endIndex = startIndex + messagesPerPage;
        const newMessages = result.data.slice(startIndex, endIndex);
        
        setMessages(prevMessages => {
          const combinedMessages = [...prevMessages, ...newMessages];
          return combineAndSortMessages(prevMessages, combinedMessages);
        });
        setHasMoreMessages(endIndex < result.data.length);
        setPage(nextPage);
      }
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [page, hasMoreMessages, isLoadingMore, params.chatSessionId]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMore) {
      loadMoreMessages();
    }
  }, [hasMoreMessages, isLoadingMore, loadMoreMessages]);

  //Subscribe to the response stream chunks for the garden
  useEffect(() => {
    const responseStreamChunkSubscriptionHandler = async () => {
      console.log('Creating response stream chunk subscription for garden: ', params.chatSessionId)
      const responseStreamChunkSub = amplifyClient.subscriptions.recieveResponseStreamChunk({ chatSessionId: params.chatSessionId }).subscribe({
        error: (error) => console.error('Error subscribing stream chunks: ', error),
        next: (newChunk) => {
          // console.log('Received new response stream chunk: ', newChunk)
          setResponseStreamChunks((prevChunks) => {
            //Now Insert the new chunk into the correct position in the array
            if (newChunk.index >= 0 && newChunk.index < prevChunks.length) {
              prevChunks[newChunk.index] = newChunk;
            } else {
              // Extend the list with nulls up to the specified index
              while (prevChunks.length < newChunk.index) {
                prevChunks.push(null)
              }
              prevChunks.push(newChunk)
            }

            //Only set the chunk message if the inital chunk is defined. This prevents the race condition between the message and the chunk
            if (prevChunks[0] || true) {
              setStreamChunkMessage({
                id: 'streamChunkMessage',
                role: 'ai',
                content: {
                  text: prevChunks.map((chunk) => chunk?.chunkText).join("")
                },
                createdAt: new Date().toISOString()
              })
            }

            return prevChunks
          })
        }
      })

      return () => {
        responseStreamChunkSub.unsubscribe();
      };

    }

    responseStreamChunkSubscriptionHandler()
  }, [params.chatSessionId])



  const handleSend = useCallback(async (userMessage: string) => {
    if (userMessage.trim()) {
      setIsLoading(true);

      const newMessage: Schema['ChatMessage']['createType'] = {
        role: 'human',
        content: {
          text: userMessage
        },
        chatSessionId: params.chatSessionId
      }

      const { newMessageData } = await sendMessage({
        chatSessionId: params.chatSessionId,
        newMessage: newMessage
      })

      // const { data: newMessageData } = await amplifyClient.models.ChatMessage.create(newMessage)
      if (newMessageData) setMessages([...messages, {
        ...newMessage,
        id: newMessageData.id,
        createdAt: newMessageData.createdAt
      }]);

      // const invokeResponse = await amplifyClient.queries.generateGarden({
      //   chatSessionId: params.chatSessionId,
      //   userInput: userInput
      // })

      // console.log('invokeResponse: ', invokeResponse)

      setUserInput('');
    }
  }, [messages, params.chatSessionId]);

  return (
    <Box sx={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'hidden'
    }}>
      <Box 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflowY: 'auto',
          flexDirection: 'column-reverse',
          display: 'flex',
          mb: 2,
          position: 'relative'
        }}
      >
        {isLoadingMore && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        <List>
          {[
            ...messages,
            ...(streamChunkMessage ? [streamChunkMessage] : [])
          ].map((message) => (
            <ListItem key={message.id}>
              <ChatMessage
                message={message}
              />
            </ListItem>
          ))}
          <div ref={messagesEndRef} />
        </List>
      </Box>
      {messages.length === 0 &&
        <Box sx={{ textAlign: 'center', margin: '8px 0' }}>
          <Typography variant="h5">How can I help you?</Typography>
          <List>
            {defaultPrompts.map((prompt, index) => (
              <ListItem key={index}>
                <Button
                  onClick={() => handleSend(prompt)}
                >
                  {prompt}
                </Button>
              </ListItem>
            ))}
          </List>
        </Box>
      }
      <Box sx={{ mt: 'auto' }}>
        <TextField
          fullWidth
          multiline
          variant="outlined"
          placeholder="Type a message..."
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              handleSend(userInput);
            }
          }}
          disabled={isLoading}
          sx={{
            position: 'relative', 
            zIndex: 1400, // Ensure higher than drawer
            '& .MuiInputBase-root': {
              backgroundColor: 'white' // Ensure opaque background
            }
          }}
        />
        <Button 
          variant="contained" 
          color={isLoading ? "secondary" : "primary"} 
          onClick={() => handleSend(userInput)} 
          sx={{ 
            marginTop: '8px', 
            width: '100%',
            position: 'relative',
            zIndex: 1400, // Ensure higher than drawer
            overflow: 'hidden',
            ...(isLoading && {
              '&::after': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                animation: 'ripple 1.5s infinite',
              },
              '@keyframes ripple': {
                '0%': {
                  transform: 'translateX(-100%)',
                },
                '100%': {
                  transform: 'translateX(100%)',
                },
              },
            })
          }}
          disabled={isLoading}
        >
          {isLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={20} color="inherit" thickness={4} />
              <span>Processing...</span>
            </Box>
          ) : 'Send'}
        </Button>
      </Box>
    </Box>
  );
};

export default ChatBox;