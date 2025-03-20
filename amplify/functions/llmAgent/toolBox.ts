import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as path from "path";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { ChatBedrockConverse } from "@langchain/aws";

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

// Schema for text to table conversion
const textToTableSchema = z.object({
    filePattern: z.string().describe("Regex pattern to select files for inclusion in the table. For example: '.*\\.txt$' for all text files, or 'data/.*' for all files in the data directory."),
    tableColumns: z.array(
        z.object({
            columnName: z.string().describe("The name of the column to include in the table."),
            columnDescription: z.string().describe("A clear description of what information should be extracted for this column."),
            columnDataDefinition: z.object({
                type: z.union([z.string(), z.array(z.string())]).describe("The data type of the column. Can be 'string', 'number', 'boolean', or an array of types."),
                format: z.string().optional().describe("Optional format for the data, e.g., 'date', 'email', etc."),
                pattern: z.string().optional().describe("Optional regex pattern that the value must match."),
                minimum: z.number().optional().describe("Optional minimum value for number types."),
                maximum: z.number().optional().describe("Optional maximum value for number types.")
            }).optional().describe("Schema definition for the column data.")
        })
    ).describe("Array of column definitions for the table."),
    includeFilePath: z.boolean().optional().default(true).describe("Whether to include the file path as a column in the table. Defaults to true."),
    maxFiles: z.number().optional().default(50).describe("Maximum number of files to process. Defaults to 50."),
    dataToInclude: z.string().optional().describe("Description of what data to prioritize inclusion of in the table."),
    dataToExclude: z.string().optional().describe("Description of what data to exclude or de-prioritize from the table."),
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

// Helper function to check if a file matches the given pattern
function fileMatchesPattern(filePath: string, pattern: string): boolean {
    try {
        const regex = new RegExp(pattern);
        return regex.test(filePath);
    } catch (error) {
        console.error(`Invalid regex pattern: ${pattern}`, error);
        return false;
    }
}

// Function to remove spaces and convert to lowercase
function normalizeColumnName(name: string): string {
    return name.replace(/\s+/g, '').toLowerCase();
}

// Text to Table conversion tool
export const textToTableTool = tool(
    async ({ filePattern, tableColumns, includeFilePath = true, maxFiles = 50, dataToInclude, dataToExclude }) => {
        console.log("Text to Table Tool Invoked");
        try {
            // Create column name map to restore original column names later
            const columnNameMap = Object.fromEntries(
                tableColumns
                    .filter(column => column.columnName !== normalizeColumnName(column.columnName))
                    .map(column => [normalizeColumnName(column.columnName), column.columnName])
            );

            // Add default score columns if dataToInclude or dataToExclude are provided
            let enhancedTableColumns = [...tableColumns];
            
            if (dataToInclude || dataToExclude) {
                enhancedTableColumns.unshift({
                    columnName: 'relevanceScore',
                    columnDescription: `
                        ${dataToExclude ? `If the text contains information related to [${dataToExclude}], give a lower score.` : ''}
                        ${dataToInclude ? `Give a higher score if text contains information related to [${dataToInclude}].` : ''}
                        Score on a scale from 0 to 10, where 10 is the most relevant.
                    `,
                    columnDataDefinition: {
                        type: 'number',
                        minimum: 0,
                        maximum: 10
                    }
                });

                enhancedTableColumns.unshift({
                    columnName: 'relevanceExplanation',
                    columnDescription: `Explain why this content received its relevance score.`,
                    columnDataDefinition: {
                        type: 'string'
                    }
                });
            }

            tableColumns.unshift({
                columnName: 'date',
                columnDescription: `The date of the event in YYYY-MM-DD format. Can be null if no date is available.`,
                columnDataDefinition: {
                    type: ['string', 'null'],
                    format: 'date',
                    pattern: "^(?:\\d{4})-(?:(0[1-9]|1[0-2]))-(?:(0[1-9]|[12]\\d|3[01]))$"
                }
            })

            // Build JSON schema for structured output
            const fieldDefinitions: Record<string, any> = {};
            for (const column of enhancedTableColumns) {
                const normalizedColumnName = normalizeColumnName(column.columnName);
                fieldDefinitions[normalizedColumnName] = {
                    ...(column.columnDataDefinition ? column.columnDataDefinition : { type: 'string' }),
                    description: column.columnDescription
                };
            }

            // Include file path column if requested
            if (includeFilePath) {
                fieldDefinitions['filePath'] = {
                    type: 'string',
                    description: 'The path of the file that this data was extracted from'
                };
            }

            const jsonSchema = {
                title: "extractTableData",
                description: "Extract structured data from text content",
                type: "object",
                properties: fieldDefinitions,
                required: Object.keys(fieldDefinitions).filter(key => key !== 'filePath')
            };

            console.log('Target JSON schema for row:', JSON.stringify(jsonSchema, null, 2));

            // Get files from session that match the pattern
            const sessionPrefix = getChatSessionPrefix();
            const matchingSessionFiles = await findFilesMatchingPattern(sessionPrefix, filePattern);
            
            // Also check global files
            const matchingGlobalFiles = await findFilesMatchingPattern(GLOBAL_PREFIX, filePattern);
            
            // Combine files from both sources
            let matchingFiles = [...matchingSessionFiles, ...matchingGlobalFiles];

            // Limit the number of files
            if (matchingFiles.length > maxFiles) {
                console.log(`Found ${matchingFiles.length} matching files, limiting to ${maxFiles}`);
                matchingFiles = matchingFiles.slice(0, maxFiles);
            }

            if (matchingFiles.length === 0) {
                return JSON.stringify({
                    error: `No files found matching pattern: ${filePattern}`
                });
            }

            console.log(`Processing ${matchingFiles.length} files`);

            // Process each file with concurrency limit
            const tableRows = [];
            const concurrencyLimit = 5; // Process 5 files at a time
            
            // Process files in batches to avoid hitting limits
            for (let i = 0; i < matchingFiles.length; i += concurrencyLimit) {
                const batch = matchingFiles.slice(i, i + concurrencyLimit);
                const batchPromises = batch.map(async (fileKey) => {
                    try {
                        const fileContent = await readS3Object(fileKey);
                        
                        // Extract file path for display
                        const filePath = fileKey.startsWith(GLOBAL_PREFIX) 
                            ? fileKey.replace(GLOBAL_PREFIX, 'global/') 
                            : fileKey.replace(sessionPrefix, '');

                        // Build the message for AI processing
                        const messageText = `
                        Extract structured data from the following text content according to the provided schema.
                        <TextContent>
                        ${fileContent}
                        </TextContent>
                        `;

                        // Use the ChatBedrockConverse model with structured output
                        const modelClient = new ChatBedrockConverse({
                            model: process.env.MODEL_ID,
                            // Add some safety to avoid excessive token usage
                            maxTokens: 4000
                        });
                        
                        // Use withStructuredOutput for more reliable extraction
                        const structuredOutput = modelClient.withStructuredOutput(jsonSchema);
                        
                        try {
                            // Create structured output extraction
                            const structuredDataResult = await structuredOutput.invoke(messageText);
                            
                            // The result should be a proper object that matches the schema
                            const structuredData: Record<string, any> = structuredDataResult;
                            
                            // Add file path if requested
                            if (includeFilePath) {
                                structuredData['filePath'] = filePath;
                            }

                            // Restore original column names
                            Object.keys(structuredData).forEach(key => {
                                if (key in columnNameMap) {
                                    const originalKey = columnNameMap[key];
                                    structuredData[originalKey] = structuredData[key];
                                    delete structuredData[key];
                                }
                            });

                            return structuredData;
                        } catch (error: unknown) {
                            console.error("Error processing with structured output:", error);
                            // Return error object
                            const errorRow: Record<string, any> = {
                                error: `Model structured output error: ${error instanceof Error ? error.message : String(error)}`
                            };
                            if (includeFilePath) {
                                errorRow['filePath'] = filePath;
                            }
                            return errorRow;
                        }
                    } catch (error: any) {
                        console.error(`Error processing file ${fileKey}:`, error);
                        // Add error row
                        const errorRow: Record<string, any> = {};
                        if (includeFilePath) {
                            errorRow['filePath'] = fileKey.replace(fileKey.startsWith(GLOBAL_PREFIX) ? GLOBAL_PREFIX : sessionPrefix, '');
                        }
                        errorRow['error'] = `Failed to process: ${error.message}`;
                        return errorRow;
                    }
                });
                
                // Wait for all batch promises to resolve
                const batchResults = await Promise.all(batchPromises);
                tableRows.push(...batchResults);
            }

            console.log(`Generated ${tableRows.length} table rows`);
            
            // Sort the table rows - primarily by date if present, otherwise by relevance score if available
            tableRows.sort((a, b) => {
                // First try to sort by date if available
                if (a['date'] && b['date']) {
                    // Compare dates (chronologically)
                    return new Date(a['date'] as string).getTime() - new Date(b['date'] as string).getTime();
                } else if (a['date']) {
                    // Items with date come before items without date
                    return -1;
                } else if (b['date']) {
                    // Items with date come before items without date
                    return 1;
                } 
                
                // If dates are not available or equal, fall back to relevance score if available
                if (dataToInclude || dataToExclude) {
                    const scoreA = (a['relevanceScore'] as number) || 0;
                    const scoreB = (b['relevanceScore'] as number) || 0;
                    return scoreB - scoreA; // Higher scores first for secondary sorting
                }
                
                // No sorting criteria available
                return 0;
            });

            return JSON.stringify({
                messageContentType: 'tool_table',
                columns: enhancedTableColumns.map(c => c.columnName),
                data: tableRows,
                matchedFileCount: matchingFiles.length
            });
        } catch (error: any) {
            console.error('Error in textToTableTool:', error);
            return JSON.stringify({
                error: `Error: ${error.message || error}`
            });
        }
    },
    {
        name: "textToTableTool",
        description: `
        This tool converts unstructured text files into a structured table format.
        Provide a regex pattern to select files and define the columns you want in the table.
        
        File pattern examples:
        - ".*\\.txt$" - all text files
        - "data/.*" - all files in the data directory
        - "logs/.*\\.log$" - all log files in the logs directory
        - "\\d{4}-\\d{2}-\\d{2}" - files with dates in YYYY-MM-DD format
        
        The file pattern is applied to the relative path (without the session prefix).
        For more efficient searching, start your pattern with a literal directory prefix when possible.
        
        The tool uses advanced structured output extraction to reliably convert unstructured text 
        into structured data based on your column definitions.
        
        Results are automatically sorted by date if present, or by relevance score as a fallback.
        Each file is processed independently, and the results are combined into a single table.
        `,
        schema: textToTableSchema,
    }
);

// Function to find files matching a pattern in S3
async function findFilesMatchingPattern(basePrefix: string, pattern: string): Promise<string[]> {
    const s3Client = getS3Client();
    const bucketName = getBucketName();
    
    // First, try to extract a common prefix from the regex pattern if possible
    let searchPrefix = basePrefix;
    
    // If pattern starts with a literal part before any regex special chars, use it as prefix
    const prefixMatch = pattern.match(/^([^\\.\*\+\?\|\(\)\[\]\{\}^$]+)/);
    if (prefixMatch && prefixMatch[1]) {
        searchPrefix = path.posix.join(basePrefix, prefixMatch[1]);
    }
    
    const matchingFiles: string[] = [];
    let continuationToken: string | undefined;
    
    do {
        // List objects with this prefix
        const listParams: any = {
            Bucket: bucketName,
            Prefix: searchPrefix,
            MaxKeys: 1000 // Fetch in larger batches
        };
        
        // Add continuation token if we have one
        if (continuationToken) {
            listParams.ContinuationToken = continuationToken;
        }
        
        try {
            const command = new ListObjectsV2Command(listParams);
            const response = await s3Client.send(command);
            
            // Extract matching files from current batch
            const currentBatchFiles = (response.Contents || [])
                .filter(item => {
                    const key = item.Key as string;
                    // Filter out directory markers and metadata files
                    if (key.endsWith('/') || key.endsWith('.s3meta')) {
                        return false;
                    }
                    
                    // Remove the base prefix for matching
                    const relativePath = key.replace(basePrefix, '');
                    return fileMatchesPattern(relativePath, pattern);
                })
                .map(item => item.Key as string);
                
            // Add matching files to our result array
            matchingFiles.push(...currentBatchFiles);
            
            // Update continuation token for next batch
            continuationToken = response.NextContinuationToken;
            
        } catch (error) {
            console.error(`Error finding files matching pattern in S3: ${error}`);
            throw error;
        }
    } while (continuationToken);
    
    return matchingFiles;
}




