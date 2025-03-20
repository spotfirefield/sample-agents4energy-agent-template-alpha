import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

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

// Schema for listing files in tmp/ directory
const listFilesSchema = z.object({
    directory: z.string().optional().describe("Optional subdirectory within tmp/ to list files from"),
});

// Schema for reading a file from tmp/ directory
const readFileSchema = z.object({
    filename: z.string().describe("The path to the file within the tmp/ directory, can include subdirectories"),
});

// Schema for writing a file to tmp/ directory
const writeFileSchema = z.object({
    filename: z.string().describe("The path to the file within the tmp/ directory, can include subdirectories"),
    content: z.string().describe("The content to write to the file"),
});

// Schema for updating a file in tmp/ directory
const updateFileSchema = z.object({
    filename: z.string().describe("The path to the file within the tmp/ directory, can include subdirectories"),
    operation: z.enum(["append", "prepend", "replace"]).describe("The type of update operation: append (add to end), prepend (add to beginning), or replace (find and replace content)"),
    content: z.string().describe("The content to add or use as replacement"),
    searchString: z.string().optional().describe("When using replace operation, the string to search for and replace. Required for replace operation."),
    createIfNotExists: z.boolean().optional().default(true).describe("Whether to create the file if it doesn't exist. Defaults to true."),
    isRegex: z.boolean().optional().default(false).describe("Whether the searchString should be treated as a regular expression. Defaults to false."),
    regexFlags: z.string().optional().default("g").describe("Flags for the regular expression (e.g., 'g' for global, 'm' for multiline, 'i' for case-insensitive). Default is 'g'. Only used when isRegex is true."),
    multiLine: z.boolean().optional().default(false).describe("Whether to enable multiline matching. This is a shorthand to set regexFlags to 'gm'. Only used when isRegex is true."),
});

// Tool to list files in the tmp/ directory
export const listFiles = tool(
    async ({ directory = "" }) => {
        try {
            const targetDir = path.resolve("/tmp", directory);
            
            // Create base tmp directory if it doesn't exist
            const tmpDir = path.resolve("/tmp");
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
                // If tmp/ didn't exist and we're trying to list a subdirectory,
                // it won't exist either, so return an empty array
                if (directory) {
                    return JSON.stringify({ files: [] });
                }
            }
            
            if (directory && !fs.existsSync(targetDir)) {
                return JSON.stringify({ error: `Directory not found: ${directory}` });
            }
            
            const files = fs.readdirSync(targetDir);
            return JSON.stringify({ files });
        } catch (error: any) {
            return JSON.stringify({ error: `Error listing files: ${error.message}` });
        }
    },
    {
        name: "listFiles",
        description: "Lists all files in the tmp/ directory or a specified subdirectory",
        schema: listFilesSchema,
    }
);

// Tool to read a file from the tmp/ directory
export const readFile = tool(
    async ({ filename }) => {
        try {
            // Normalize the path to prevent path traversal attacks
            // by ensuring the final path is within the tmp directory
            const targetPath = path.normalize(filename);
            if (targetPath.startsWith("..")) {
                return JSON.stringify({ error: "Invalid file path. Cannot access files outside tmp/ directory." });
            }
            
            const filePath = path.resolve("/tmp", targetPath);
            const content = fs.readFileSync(filePath, "utf8");
            return JSON.stringify({ content });
        } catch (error: any) {
            return JSON.stringify({ error: `Error reading file: ${error.message}` });
        }
    },
    {
        name: "readFile",
        description: "Reads the content of a file from the tmp/ directory, supports nested directories",
        schema: readFileSchema,
    }
);

// Tool to update a file without rewriting the entire content
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
                return JSON.stringify({ error: "Invalid file path. Cannot update files outside tmp/ directory." });
            }
            
            const tmpDir = path.resolve("/tmp");
            // Create tmp directory if it doesn't exist
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            
            const filePath = path.resolve(tmpDir, targetPath);
            
            // Create directory structure if needed
            const dirPath = path.dirname(filePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            
            // Check if file exists
            const fileExists = fs.existsSync(filePath);
            
            // If file does not exist and createIfNotExists is false, return error
            if (!fileExists && !createIfNotExists) {
                return JSON.stringify({ error: `File does not exist: ${filename}` });
            }
            
            // Read existing content if file exists
            let existingContent = fileExists ? fs.readFileSync(filePath, "utf8") : "";
            
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
            
            // Write the updated content to the file
            fs.writeFileSync(filePath, newContent);
            
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
        description: "Updates a file by appending, prepending, or replacing content without rewriting the entire file. Supports multi-line replacements and regular expressions.",
        schema: updateFileSchema,
    }
);

// Tool to write a file to the tmp/ directory
export const writeFile = tool(
    async ({ filename, content }) => {
        try {
            // Normalize the path to prevent path traversal attacks
            const targetPath = path.normalize(filename);
            if (targetPath.startsWith("..")) {
                return JSON.stringify({ error: "Invalid file path. Cannot write files outside tmp/ directory." });
            }
            
            const tmpDir = path.resolve("/tmp");
            // Create tmp directory if it doesn't exist
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            
            const filePath = path.resolve(tmpDir, targetPath);
            
            // Create directory structure if needed
            const dirPath = path.dirname(filePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            
            fs.writeFileSync(filePath, content);
            return JSON.stringify({ success: true, message: `File ${filename} written successfully` });
        } catch (error: any) {
            return JSON.stringify({ error: `Error writing file: ${error.message}` });
        }
    },
    {
        name: "writeFile",
        description: "Writes content to a file in the tmp/ directory, supports nested directories",
        schema: writeFileSchema,
    }
);


