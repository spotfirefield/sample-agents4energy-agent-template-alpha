import { stringify } from "yaml";

import { getConfiguredAmplifyClient } from '../../../utils/amplifyUtils';

import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, ToolMessage, BaseMessage, SystemMessage, AIMessageChunk } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Calculator } from "@langchain/community/tools/calculator";
// import { PythonInterpreterTool } from "@langchain/community/experimental/tools/pyinterpreter";
// import pyodideModule from "pyodide/pyodide.js";
// import * as pyodide from "pyodide";

import { publishResponseStreamChunk } from "../graphql/mutations";

import { userInputTool, listFiles, readFile, updateFile } from "./toolBox";
import { Schema } from '../../data/resource';

import { getLangChainChatMessagesStartingWithHumanMessage, getLangChainMessageTextContent, publishMessage, stringifyLimitStringLength } from '../../../utils/langChainUtils';
import path from "path";
import fs from "fs";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";


export const handler: Schema["invokeAgent"]["functionHandler"] = async (event, context) => {
    console.log('event:\n', JSON.stringify(event, null, 2))

    try {
        if (event.arguments.chatSessionId === null) throw new Error("chatSessionId is required");
        if (!event.identity) throw new Error("Event does not contain identity");
        if (!('sub' in event.identity)) throw new Error("Event does not contain user");

        // Create S3 client early as we need it for downloading files
        const s3Client = new S3Client();
        
        // Define the S3 prefix for this chat session
        const bucketName = process.env.STORAGE_BUCKET_NAME;
        if (!bucketName) throw new Error("STORAGE_BUCKET_NAME is not set");
        const s3Prefix = `chatSessionArtifacts/sessionId=${event.arguments.chatSessionId}/`;
        
        // Ensure tmp directory exists
        const tmpDir = path.resolve("/tmp");
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Load any existing files from S3 into the tmp directory
        console.log(`Loading existing files from s3://${bucketName}/${s3Prefix}...`);
        try {
            await downloadDirectoryFromS3(bucketName, s3Prefix, tmpDir, s3Client);
            console.log(`Successfully downloaded files from s3://${bucketName}/${s3Prefix} to ${tmpDir}`);
        } catch (error) {
            console.log(`No existing files found or error downloading: ${error instanceof Error ? error.message : String(error)}`);
            // Continue execution even if downloading fails - might be first run with no files yet
        }

        const amplifyClient = getConfiguredAmplifyClient();

        const chatSessionMessages = await getLangChainChatMessagesStartingWithHumanMessage(event.arguments.chatSessionId)

        const agentModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            // temperature: 0
        });

        // const pyodideInstance = await pyodide.loadPyodide();
        // const pythonInterpreterTool = new PythonInterpreterTool({instance: pyodideInstance})
        // await pythonInterpreterTool.addPackage("numpy");

        const agentTools = [
            new Calculator(),
            // pythonInterpreterTool,
            userInputTool,
            listFiles,
            readFile,
            updateFile
        ]

        const agent = createReactAgent({
            llm: agentModel,
            tools: agentTools,
        });

        let systemMessageContent = `
You are a helpful llm agent showing a demo workflow. 
If you don't have the access to the information you need, make a reasonable guess and continue the demo.
Use markdown formatting for your responses (like **bold**, *italic*, ## headings, etc.), but DO NOT wrap your response in markdown code blocks.
Today's date is ${new Date().toLocaleDateString()}.
        `//.replace(/^\s+/gm, '') //This trims the whitespace from the beginning of each line
        
        // If the chatSessionMessages ends with a human message, remove it.
        if (chatSessionMessages.length > 0 && 
            chatSessionMessages[chatSessionMessages.length - 1] instanceof HumanMessage) {
            chatSessionMessages.pop();
        }

        const input = {
            messages: [
                new SystemMessage({
                    content: systemMessageContent
                }),
                ...chatSessionMessages,
                new HumanMessage({
                    content: event.arguments.userInput
                })
            ].filter((message): message is BaseMessage => message !== undefined)
        }

        console.log('input:\n', stringify(input))

        const agentEventStream = agent.streamEvents(
            input,
            {
                version: "v2",
            }
        );

        let chunkIndex = 0
        for await (const streamEvent of agentEventStream) {
            switch (streamEvent.event) {
                case "on_chat_model_stream":
                    const tokenStreamChunk = streamEvent.data.chunk as AIMessageChunk
                    if (!tokenStreamChunk.content) continue
                    const chunkText = getLangChainMessageTextContent(tokenStreamChunk)
                    process.stdout.write(chunkText || "")
                    const publishChunkResponse = await amplifyClient.graphql({
                        query: publishResponseStreamChunk,
                        variables: {
                            chunkText: chunkText || "",
                            index: chunkIndex++,
                            chatSessionId: event.arguments.chatSessionId
                        }
                    })
                    // console.log('published chunk response:\n', JSON.stringify(publishChunkResponse, null, 2))
                    if (publishChunkResponse.errors) console.log('Error publishing response chunk:\n', publishChunkResponse.errors)
                    break;
                case "on_tool_end":
                case "on_chat_model_end":
                    chunkIndex = 0 //reset the stream chunk index
                    const streamChunk = streamEvent.data.output as ToolMessage | AIMessageChunk
                    console.log('received on chat model end:\n', stringifyLimitStringLength(streamChunk))
                    await publishMessage({
                        chatSessionId: event.arguments.chatSessionId,
                        owner: event.identity.sub,
                        message: streamChunk
                    })
                    break
            }
        }

        //Upload the tmp/ directory to the S3 bucket
        // Already have tmpDir and bucketName defined at the beginning
        
        // Check if tmp directory exists
        if (fs.existsSync(tmpDir)) {
            // Upload all files from tmp directory to S3
            await uploadDirectoryToS3(tmpDir, bucketName, s3Prefix, s3Client);
            console.log(`Successfully uploaded tmp directory contents to s3://${bucketName}/${s3Prefix}`);
        } else {
            console.log("No tmp directory found, skipping S3 upload");
        }
        

    } catch (error) {
        console.error("Error responding to user:", JSON.stringify(error, null, 2));
        if (error instanceof Error) {
            throw new Error(`Error responding to user:\n${error.message}`);
        } else {
            throw new Error("Error responding to user: \nUnknown error");
        }
    }
}

/**
 * Downloads all files from an S3 bucket with the specified prefix to a local directory
 * Skips downloading if the local file already exists and matches the remote file
 * 
 * @param bucketName The S3 bucket name
 * @param prefix The S3 key prefix
 * @param localDir The local directory to download files to
 * @param s3Client The S3 client instance
 */
async function downloadDirectoryFromS3(
    bucketName: string,
    prefix: string,
    localDir: string,
    s3Client: S3Client
): Promise<void> {
    // List all objects with the specified prefix
    const listParams = {
        Bucket: bucketName,
        Prefix: prefix
    };
    
    let isTruncated = true;
    let continuationToken: string | undefined;
    let downloadCount = 0;
    let skippedCount = 0;
    
    while (isTruncated) {
        const listCommand = new ListObjectsV2Command({
            ...listParams,
            ContinuationToken: continuationToken
        });
        
        const listResponse = await s3Client.send(listCommand);
        
        // Process the objects
        if (listResponse.Contents) {
            for (const object of listResponse.Contents) {
                if (!object.Key) continue;
                
                // Skip the prefix directory itself
                if (object.Key === prefix) continue;
                
                // Calculate the relative path by removing the prefix
                const relativePath = object.Key.substring(prefix.length);
                if (!relativePath) continue; // Skip empty paths
                
                // Create local directory structure if needed
                const localFilePath = path.join(localDir, relativePath);
                const localDirPath = path.dirname(localFilePath);
                
                if (!fs.existsSync(localDirPath)) {
                    fs.mkdirSync(localDirPath, { recursive: true });
                }

                // Check if file already exists locally and if it's the same version
                const shouldDownload = await shouldDownloadFile(
                    localFilePath, 
                    object.Size,
                    object.LastModified,
                    object.ETag
                );

                if (!shouldDownload) {
                    console.log(`Skipping ${object.Key} - local file is up to date`);
                    skippedCount++;
                    continue;
                }
                
                // Download the file
                const getParams = {
                    Bucket: bucketName,
                    Key: object.Key
                };
                
                try {
                    const getCommand = new GetObjectCommand(getParams);
                    const response = await s3Client.send(getCommand);
                    
                    if (response.Body) {
                        // Convert stream to buffer
                        const chunks: Buffer[] = [];
                        for await (const chunk of response.Body as any) {
                            chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
                        }
                        const fileBuffer = Buffer.concat(chunks);
                        
                        // Write file to disk
                        fs.writeFileSync(localFilePath, fileBuffer);

                        // Store metadata to help with future comparisons
                        if (response.ETag || response.LastModified) {
                            const metadataFile = `${localFilePath}.s3meta`;
                            fs.writeFileSync(metadataFile, JSON.stringify({
                                ETag: response.ETag,
                                LastModified: response.LastModified?.toISOString(),
                                Size: fileBuffer.length
                            }));
                        }

                        console.log(`Downloaded ${object.Key} to ${localFilePath}`);
                        downloadCount++;
                    }
                } catch (error) {
                    console.error(`Error downloading ${object.Key}:`, error);
                }
            }
        }
        
        // Check if there are more objects to fetch
        isTruncated = listResponse.IsTruncated || false;
        continuationToken = listResponse.NextContinuationToken;
        
        if (!continuationToken) {
            isTruncated = false;
        }
    }

    console.log(`Download summary: ${downloadCount} files downloaded, ${skippedCount} files skipped (already up to date)`);
}

/**
 * Determines if a file should be downloaded based on metadata comparison
 * 
 * @param localFilePath The local file path
 * @param remoteSize The remote file size in bytes
 * @param remoteLastModified The remote file last modified date
 * @param remoteETag The remote file ETag
 * @returns True if the file should be downloaded, false if it can be skipped
 */
async function shouldDownloadFile(
    localFilePath: string,
    remoteSize?: number,
    remoteLastModified?: Date,
    remoteETag?: string
): Promise<boolean> {
    // If file doesn't exist locally, always download
    if (!fs.existsSync(localFilePath)) {
        return true;
    }

    // Check if we have stored metadata from previous download
    const metadataFile = `${localFilePath}.s3meta`;
    if (fs.existsSync(metadataFile)) {
        try {
            const metadataStr = fs.readFileSync(metadataFile, 'utf8');
            const metadata = JSON.parse(metadataStr);
            
            // If ETag matches, files are the same (ETag is in quotes in S3 response)
            if (remoteETag && metadata.ETag) {
                const cleanLocalETag = metadata.ETag.replace(/"/g, '');
                const cleanRemoteETag = remoteETag.replace(/"/g, '');
                if (cleanLocalETag === cleanRemoteETag) {
                    return false; // ETag matches, no need to download
                }
            }
            
            // If both size and last modified match, files are likely the same
            if (remoteSize && metadata.Size && remoteLastModified && metadata.LastModified) {
                const remoteModifiedMs = new Date(remoteLastModified).getTime();
                const localModifiedMs = new Date(metadata.LastModified).getTime();
                
                if (remoteSize === metadata.Size && remoteModifiedMs === localModifiedMs) {
                    return false; // Size and last modified match, no need to download
                }
            }
        } catch (error) {
            // If metadata parsing fails, fall back to size comparison
            console.log(`Error reading metadata for ${localFilePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    // If no metadata available or comparison failed, compare file sizes as a fallback
    if (remoteSize) {
        const stats = fs.statSync(localFilePath);
        if (stats.size === remoteSize) {
            // Same size, likely the same file, but can't be certain
            // We'll still download to be safe unless we had matching ETags
            return true;
        }
    }
    
    // Default behavior - download the file
    return true;
}

/**
 * Recursively uploads all files from a directory to an S3 bucket
 * 
 * @param directoryPath The local directory path to upload
 * @param bucketName The S3 bucket name
 * @param prefix The S3 key prefix
 * @param s3Client The S3 client instance
 */
async function uploadDirectoryToS3(
    directoryPath: string, 
    bucketName: string, 
    prefix: string, 
    s3Client: S3Client
): Promise<void> {
    // Read the directory contents
    const items = fs.readdirSync(directoryPath);
    
    for (const item of items) {
        const itemPath = path.join(directoryPath, item);
        const itemStats = fs.statSync(itemPath);
        
        if (itemStats.isDirectory()) {
            // Recursively upload subdirectories
            const subDirPrefix = `${prefix}${item}/`;
            await uploadDirectoryToS3(itemPath, bucketName, subDirPrefix, s3Client);
        } else {
            // Calculate the S3 key, removing the tmpDir part from the path
            const relativePath = path.relative(path.resolve("/tmp"), itemPath);
            const s3Key = `${prefix}${relativePath}`;
            
            // Read the file
            const fileContent = fs.readFileSync(itemPath);
            
            // Upload to S3
            const uploadParams = {
                Bucket: bucketName,
                Key: s3Key,
                Body: fileContent,
                ContentType: getContentType(itemPath)
            };
            
            try {
                const uploadCommand = new PutObjectCommand(uploadParams);
                await s3Client.send(uploadCommand);
                console.log(`Uploaded ${itemPath} to s3://${bucketName}/${s3Key}`);
            } catch (error) {
                console.error(`Error uploading ${itemPath} to S3:`, error);
                throw error;
            }
        }
    }
}

/**
 * Determines the content type based on the file extension
 * 
 * @param filePath The file path
 * @returns The content type
 */
function getContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    
    const contentTypeMap: Record<string, string> = {
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.md': 'text/markdown',
        '.csv': 'text/csv',
        '.xml': 'application/xml',
        '.zip': 'application/zip'
    };
    
    return contentTypeMap[extension] || 'application/octet-stream';
}