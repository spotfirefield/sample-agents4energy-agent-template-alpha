import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as path from "path";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

const userInputToolSchema = z.object({
    title: z.string(),
    description: z.string(),
    buttonTextBeforeClick: z.string(),
    buttonTextAfterClick: z.string(),
})

export const userInputTool = tool(
    async (userInputToolArgs) => {

        return {
            ...userInputToolArgs,
        }
    },
    {
        name: "userInputTool",
        description: `
Use this tool to send emails or add items to a work management system.
The messages should never request information.
They should only inform someone besides the user about an action they should take (including to review an item from the chat).
`,
        schema: userInputToolSchema,
    }
);

// Schema for listing files
const listFilesSchema = z.object({
    directory: z.string().optional().describe("Optional subdirectory to list files from. Use 'global' to access shared files across all sessions."),
});

// Schema for reading a file
const readFileSchema = z.object({
    filename: z.string().describe("The path to the file. This can include subdirectories"),
});

// Schema for writing a file
const writeFileSchema = z.object({
    filename: z.string().describe("The path to the file. This can include subdirectories"),
    content: z.string().describe("The content to write to the file"),
});

// Schema for updating a file
const updateFileSchema = z.object({
    filename: z.string().describe("The path to the file. This can include subdirectories"),
    operation: z.enum(["append", "prepend", "replace"]).describe("The type of update operation: append (add to end), prepend (add to beginning), or replace (find and replace content)"),
    content: z.string().describe("The content to add or use as replacement"),
    searchString: z.string().optional().describe("When using replace operation, the string to search for and replace. Required for replace operation."),
    createIfNotExists: z.boolean().optional().default(true).describe("Whether to create the file if it doesn't exist. Defaults to true."),
    isRegex: z.boolean().optional().default(false).describe("Whether the searchString should be treated as a regular expression. Defaults to false."),
    regexFlags: z.string().optional().default("g").describe("Flags for the regular expression (e.g., 'g' for global, 'm' for multiline, 'i' for case-insensitive). Default is 'g'. Only used when isRegex is true."),
    multiLine: z.boolean().optional().default(false).describe("Whether to enable multiline matching. This is a shorthand to set regexFlags to 'gm'. Only used when isRegex is true."),
});

// Helper functions for S3 operations
function getS3Client() {
    return new S3Client();
}

function getBucketName() {
    const bucketName = process.env.STORAGE_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("STORAGE_BUCKET_NAME is not set");
    }
    return bucketName;
}

// Global variable for storing the chat session ID provided by the handler
let _chatSessionId: string | null = null;

// Function to set the chat session ID from the handler
export function setChatSessionId(chatSessionId: string) {
    _chatSessionId = chatSessionId;
}

// Global prefix for shared files
const GLOBAL_PREFIX = 'global/';

function getChatSessionPrefix() {
    if (!_chatSessionId) {
        throw new Error("Chat session ID not set. Call setChatSessionId first.");
    }
    
    return `chatSessionArtifacts/sessionId=${_chatSessionId}/`;
}

// Get the correct S3 prefix based on path
function getS3KeyPrefix(filepath: string) {
    // If path starts with 'global/', use the global prefix
    if (filepath.startsWith('global/')) {
        return '';
    }
    
    // Otherwise use the session-specific prefix
    return getChatSessionPrefix();
}

async function listS3Objects(prefix: string) {
    const s3Client = getS3Client();
    const bucketName = getBucketName();
    
    const listParams = {
        Bucket: bucketName,
        Prefix: prefix,
        Delimiter: '/' // Use delimiter to simulate directory structure
    };
    
    try {
        const command = new ListObjectsV2Command(listParams);
        const response = await s3Client.send(command);
        
        // Process directories (CommonPrefixes)
        const directories = (response.CommonPrefixes || [])
            .map(prefixObj => {
                const name = prefixObj.Prefix?.replace(prefix, '').replace('/', '');
                return name ? { name, type: 'directory' } : null;
            })
            .filter(Boolean) as { name: string, type: 'directory' }[];
            
        // Process files (Contents)
        const files = (response.Contents || [])
            .filter(item => item.Key !== prefix) // Filter out the directory itself
            .map(item => {
                const key = item.Key as string;
                const name = key.substring(prefix.length);
                return name && !name.endsWith('/') && !name.endsWith('.s3meta') 
                    ? { name, type: 'file' } 
                    : null;
            })
            .filter(Boolean) as { name: string, type: 'file' }[];
            
        // Return combined array with type indicators
        return [...directories, ...files];
    } catch (error) {
        console.error("Error listing S3 objects:", error);
        throw error;
    }
}

async function readS3Object(key: string) {
    const s3Client = getS3Client();
    const bucketName = getBucketName();
    
    const getParams = {
        Bucket: bucketName,
        Key: key
    };
    
    try {
        const command = new GetObjectCommand(getParams);
        const response = await s3Client.send(command);
        
        if (response.Body) {
            // Convert stream to string
            const chunks: Buffer[] = [];
            for await (const chunk of response.Body as any) {
                chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
            }
            const content = Buffer.concat(chunks).toString('utf8');
            return content;
        } else {
            throw new Error("No content found");
        }
    } catch (error) {
        console.error(`Error reading S3 object ${key}:`, error);
        throw error;
    }
}

async function writeS3Object(key: string, content: string) {
    const s3Client = getS3Client();
    const bucketName = getBucketName();
    
    const putParams = {
        Bucket: bucketName,
        Key: key,
        Body: content,
        ContentType: getContentType(key)
    };
    
    try {
        const command = new PutObjectCommand(putParams);
        await s3Client.send(command);
        return true;
    } catch (error) {
        console.error(`Error writing S3 object ${key}:`, error);
        throw error;
    }
}

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

// Tool to list files
export const listFiles = tool(
    async ({ directory = "" }) => {
        try {
            // Handle global directory listing
            if (directory.startsWith('global') || directory === 'global') {
                const globalDir = directory === 'global' ? 'global/' : directory;
                let fullPrefix = path.posix.join('', globalDir);
                if (!fullPrefix.endsWith('/')) {
                    fullPrefix += '/';
                }
                
                const items = await listS3Objects(fullPrefix);
                // Group items by type for better clarity
                const directories = items.filter(item => item.type === 'directory');
                const files = items.filter(item => item.type === 'file');
                
                return JSON.stringify({ 
                    path: directory,
                    directories: directories.map(d => d.name),
                    files: files.map(f => f.name),
                    items // Keep the original items with type info for backward compatibility
                });
            }
            
            // Handle session-specific directory listing
            const sessionPrefix = getChatSessionPrefix();
            let fullPrefix = path.posix.join(sessionPrefix, directory);
            if (!fullPrefix.endsWith('/')) {
                fullPrefix += '/';
            }
            
            const items = await listS3Objects(fullPrefix);
            // Group items by type for better clarity
            const directories = items.filter(item => item.type === 'directory');
            const files = items.filter(item => item.type === 'file');
            
            return JSON.stringify({ 
                path: directory,
                directories: directories.map(d => d.name),
                files: files.map(f => f.name),
                items // Keep the original items with type info for backward compatibility
            });
        } catch (error: any) {
            return JSON.stringify({ error: `Error listing files: ${error.message}` });
        }
    },
    {
        name: "listFiles",
        description: "Lists files and directories from S3 storage. The response clearly distinguishes between directories and files. Use 'global' or 'global/path' to access shared files across all sessions, or a regular path for session-specific files.",
        schema: listFilesSchema,
    }
);

// Tool to read a file from S3
export const readFile = tool(
    async ({ filename }) => {
        try {
            // Normalize the path to prevent path traversal attacks
            const targetPath = path.normalize(filename);
            if (targetPath.startsWith("..")) {
                return JSON.stringify({ error: "Invalid file path. Cannot access files outside project root directory." });
            }
            
            const prefix = getS3KeyPrefix(targetPath);
            const s3Key = path.posix.join(prefix, targetPath);
            
            try {
                const content = await readS3Object(s3Key);
                return JSON.stringify({ content });
            } catch (error: any) {
                if (error.name === 'NoSuchKey') {
                    return JSON.stringify({ error: `File not found: ${filename}` });
                }
                throw error;
            }
        } catch (error: any) {
            return JSON.stringify({ error: `Error reading file: ${error.message}` });
        }
    },
    {
        name: "readFile",
        description: "Reads the content of a file from S3 storage. Use 'global/filename' path to access shared files across all sessions.",
        schema: readFileSchema,
    }
);

// Tool to update a file in S3
export const updateFile = tool(
    async ({ 
        filename, 
        operation, 
        content, 
        searchString, 
        createIfNotExists = true,
        isRegex = false,
        regexFlags = "g",
        multiLine = false
    }) => {
        try {
            // Normalize the path to prevent path traversal attacks
            const targetPath = path.normalize(filename);
            if (targetPath.startsWith("..")) {
                return JSON.stringify({ error: "Invalid file path. Cannot update files outside project root directory." });
            }
            
            // Prevent updating files with global/ prefix
            if (targetPath.startsWith("global/")) {
                return JSON.stringify({ error: "Cannot update files in the global directory. Global files are read-only." });
            }
            
            const prefix = getChatSessionPrefix();
            const s3Key = path.posix.join(prefix, targetPath);
            
            // Check if file exists and get content if it does
            let existingContent = "";
            let fileExists = true;
            
            try {
                existingContent = await readS3Object(s3Key);
            } catch (error: any) {
                if (error.name === 'NoSuchKey') {
                    fileExists = false;
                    
                    // If file does not exist and createIfNotExists is false, return error
                    if (!createIfNotExists) {
                        return JSON.stringify({ error: `File does not exist: ${filename}` });
                    }
                } else {
                    throw error;
                }
            }
            
            let newContent;
            
            switch (operation) {
                case "append":
                    newContent = existingContent + content;
                    break;
                case "prepend":
                    newContent = content + existingContent;
                    break;
                case "replace":
                    // For non-existent or empty files, just use the new content without requiring searchString
                    if (!existingContent || existingContent.length === 0) {
                        newContent = content;
                        break;
                    }

                    // searchString is only required for non-empty files
                    if (!searchString) {
                        return JSON.stringify({ error: "searchString is required for replace operation on non-empty files" });
                    }
                    
                    if (isRegex) {
                        // If multiLine flag is set, override the regexFlags to include 'm'
                        const flags = multiLine ? "gm" : regexFlags;
                        try {
                            const regex = new RegExp(searchString, flags);
                            newContent = existingContent.replace(regex, content);
                        } catch (regexError: any) {
                            return JSON.stringify({ 
                                error: `Invalid regular expression: ${regexError.message}` 
                            });
                        }
                    } else {
                        // Escape the search string to treat it as a literal string
                        // For non-regex mode, we still want to match across multiple lines if multiLine is true
                        if (multiLine) {
                            // Split the content by lines, replace in each line, then join back
                            const lines = existingContent.split('\n');
                            
                            // Join the searchString with newlines to create a search pattern
                            const searchLines = searchString.split('\n');
                            
                            // Find the starting line of each potential match
                            for (let i = 0; i <= lines.length - searchLines.length; i++) {
                                let matches = true;
                                
                                // Check if the current position is a full match for searchLines
                                for (let j = 0; j < searchLines.length; j++) {
                                    if (lines[i + j] !== searchLines[j]) {
                                        matches = false;
                                        break;
                                    }
                                }
                                
                                // If we found a match, replace it
                                if (matches) {
                                    // Remove the matching lines
                                    lines.splice(i, searchLines.length);
                                    
                                    // Insert the new content lines
                                    const contentLines = content.split('\n');
                                    for (let j = contentLines.length - 1; j >= 0; j--) {
                                        lines.splice(i, 0, contentLines[j]);
                                    }
                                    
                                    // Adjust i to skip past what we just inserted
                                    i += contentLines.length - 1;
                                }
                            }
                            
                            newContent = lines.join('\n');
                        } else {
                            // For single-line replacements, use the standard replace method
                            newContent = existingContent.split(searchString).join(content);
                        }
                    }
                    break;
                default:
                    return JSON.stringify({ error: "Invalid operation. Must be 'append', 'prepend', or 'replace'" });
            }
            
            // Write the updated content to S3
            await writeS3Object(s3Key, newContent);
            
            const operationMessage = {
                "append": "appended to",
                "prepend": "prepended to",
                "replace": "updated in"
            }[operation];
            
            return JSON.stringify({ 
                success: true, 
                message: `Content successfully ${operationMessage} file ${filename}`,
                operation,
                fileExistedBefore: fileExists
            });
        } catch (error: any) {
            return JSON.stringify({ error: `Error updating file: ${error.message}` });
        }
    },
    {
        name: "updateFile",
        description: "Updates a file in session storage. Global files (global/filename) are read-only and cannot be updated.",
        schema: updateFileSchema,
    }
);

// Tool to write a file to S3
export const writeFile = tool(
    async ({ filename, content }) => {
        try {
            // Normalize the path to prevent path traversal attacks
            const targetPath = path.normalize(filename);
            if (targetPath.startsWith("..")) {
                return JSON.stringify({ error: "Invalid file path. Cannot write files outside project root directory." });
            }
            
            // Prevent writing files with global/ prefix
            if (targetPath.startsWith("global/")) {
                return JSON.stringify({ error: "Cannot write files to the global directory. Global files are read-only." });
            }
            
            const prefix = getChatSessionPrefix();
            const s3Key = path.posix.join(prefix, targetPath);
            
            // Create parent "directory" keys if needed
            const dirPath = path.dirname(targetPath);
            if (dirPath !== '.') {
                const directories = dirPath.split('/').filter(Boolean);
                let currentPath = prefix;
                
                for (const dir of directories) {
                    currentPath = path.posix.join(currentPath, dir, '/');
                    // Create an empty object with trailing slash to represent directory
                    await writeS3Object(currentPath, '');
                }
            }
            
            // Write the file to S3
            await writeS3Object(s3Key, content);
            
            return JSON.stringify({ success: true, message: `File ${filename} written successfully to S3` });
        } catch (error: any) {
            return JSON.stringify({ error: `Error writing file: ${error.message}` });
        }
    },
    {
        name: "writeFile",
        description: "Writes content to a file in session storage. Global files (global/filename) are read-only and cannot be written to.",
        schema: writeFileSchema,
    }
);


