import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AthenaClient, StartCalculationExecutionCommand, GetCalculationExecutionCommand, StartSessionCommand, GetSessionStatusCommand } from '@aws-sdk/client-athena';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { getConfiguredAmplifyClient } from '../../../utils/amplifyUtils';
import { publishResponseStreamChunk } from "../graphql/mutations";
import { getChatSessionId } from "./toolUtils";
// Environment variables
const ATHENA_WORKGROUP = process.env.ATHENA_WORKGROUP_NAME || 'pyspark-workgroup';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Helper function to read a file from S3
async function readS3File(s3Uri: string): Promise<string> {
    try {
        // Parse the S3 URI - handle both s3:/ and s3:// formats
        if (!s3Uri.startsWith('s3:/')) {
            throw new Error(`Invalid S3 URI: ${s3Uri}`);
        }

        // Normalize the URI by removing the protocol part
        let uriWithoutProtocol: string;
        if (s3Uri.startsWith('s3://')) {
            uriWithoutProtocol = s3Uri.substring(5); // Remove 's3://'
        } else if (s3Uri.startsWith('s3:/')) {
            uriWithoutProtocol = s3Uri.substring(4); // Remove 's3:/'
        } else {
            throw new Error(`Unexpected S3 URI format: ${s3Uri}`);
        }
        
        const firstSlashIndex = uriWithoutProtocol.indexOf('/');
        
        if (firstSlashIndex === -1) {
            throw new Error(`Invalid S3 URI format: ${s3Uri}`);
        }
        
        const bucket = uriWithoutProtocol.substring(0, firstSlashIndex);
        const key = uriWithoutProtocol.substring(firstSlashIndex + 1);
        
        console.log(`Parsing S3 URI: ${s3Uri}`);
        console.log(`Bucket: ${bucket}, Key: ${key}`);
        
        // Create S3 client
        const s3Client = new S3Client({ region: AWS_REGION });
        
        // Get the object
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });
        
        const response = await s3Client.send(command);
        
        // Convert stream to string
        if (!response.Body) {
            throw new Error('No content found in S3 object');
        }
        
        // Read the stream
        const chunks: Buffer[] = [];
        for await (const chunk of response.Body as any) {
            chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
        }
        
        return Buffer.concat(chunks).toString('utf8');
    } catch (error: any) {
        console.error(`Error reading S3 file ${s3Uri}:`, error);
        return JSON.stringify({
            error: `Error reading S3 object ${s3Uri}: ${error.message}`
        });
    }
}

// Helper function to publish progress updates
async function publishProgress(chatSessionId: string, message: string, index: number = 0) {
    try {
        const amplifyClient = getConfiguredAmplifyClient();
        await amplifyClient.graphql({
            query: publishResponseStreamChunk,
            variables: {
                chatSessionId,
                chunkText: message,
                index
            }
        });
        console.log(`Progress update: ${message}`);
    } catch (error) {
        console.error('Error publishing progress update:', error);
    }
}

// Helper function to fetch calculation outputs from S3
async function fetchCalculationOutputs(resultData: any, chatSessionId: string, progressIndex: number) {
    let stdoutContent = "";
    let stderrContent = "";
    let resultContent = "";
    
    try {
        await publishProgress(chatSessionId, "📥 Downloading results from S3...", progressIndex++);
        
        // Fetch stdout content if available
        if (resultData?.StdOutS3Uri) {
            const stdoutResult = await readS3File(resultData.StdOutS3Uri);
            try {
                const parsedStdout = JSON.parse(stdoutResult);
                if (parsedStdout.error) {
                    console.error('Error reading stdout file:', parsedStdout.error);
                    await publishProgress(chatSessionId, `⚠️ Warning: Error reading output: ${parsedStdout.error}`, progressIndex++);
                } else {
                    stdoutContent = stdoutResult;
                }
            } catch {
                stdoutContent = stdoutResult;
            }
        }
        
        // Fetch result content if available
        if (resultData?.ResultS3Uri) {
            const resultS3Content = await readS3File(resultData.ResultS3Uri);
            try {
                const parsedResult = JSON.parse(resultS3Content);
                if (parsedResult.error) {
                    console.error('Error reading result file:', parsedResult.error);
                    await publishProgress(chatSessionId, `⚠️ Warning: Error reading result data: ${parsedResult.error}`, progressIndex++);
                } else {
                    resultContent = resultS3Content;
                }
            } catch {
                resultContent = resultS3Content;
            }
        }
        
        // Fetch stderr content if available
        if (resultData?.StdErrorS3Uri) {
            const stderrS3Content = await readS3File(resultData.StdErrorS3Uri);
            try {
                const parsedStderr = JSON.parse(stderrS3Content);
                if (parsedStderr.error) {
                    console.error('Error reading stderr file:', parsedStderr.error);
                } else {
                    stderrContent = stderrS3Content;
                    if (stderrContent.trim()) {
                        await publishProgress(chatSessionId, `⚠️ Warning: Execution produced errors: ${stderrContent.substring(0, 100)}${stderrContent.length > 100 ? '...' : ''}`, progressIndex++);
                    }
                }
            } catch {
                stderrContent = stderrS3Content;
                if (stderrContent.trim()) {
                    await publishProgress(chatSessionId, `⚠️ Warning: Execution produced errors: ${stderrContent.substring(0, 100)}${stderrContent.length > 100 ? '...' : ''}`, progressIndex++);
                }
            }
        }
    } catch (error) {
        console.error('Error fetching calculation output:', error);
        await publishProgress(chatSessionId, `⚠️ Warning: Error while fetching output: ${error}`, progressIndex++);
    }
    
    return {
        stdout: stdoutContent,
        result: resultContent,
        stderr: stderrContent,
        s3: {
            stdout: resultData?.StdOutS3Uri,
            result: resultData?.ResultS3Uri,
            stderr: resultData?.StdErrorS3Uri
        }
    };
}

// Schema for the PySpark execution tool
const pysparkToolSchema = z.object({
    code: z.string().describe("PySpark code to execute. The 'spark' session is already initialized."),
    timeout: z.number().optional().default(300).describe("Timeout in seconds for the execution"),
    description: z.string().optional().describe("Optional description for the execution")
});

export const pysparkTool = tool(
    async (params) => {
        const { code, timeout = 300, description = "PySpark execution" } = params;
        let progressIndex = 0;
        const chatSessionId = getChatSessionId();
        if (!chatSessionId) {
            throw new Error("Chat session ID not found");
        }
        try {
            // Publish initial message
            await publishProgress(chatSessionId, "🚀 Starting PySpark execution environment...", progressIndex++);
            
            // Create Athena client
            const athenaClient = new AthenaClient({ region: AWS_REGION });
            
            // Start a session
            await publishProgress(chatSessionId, "🔄 Creating Athena session...", progressIndex++);
            // const sessionToken = uuidv4();
            const startSessionCommand = new StartSessionCommand({
                WorkGroup: ATHENA_WORKGROUP,
                Description: `Session for ${description}`,
                ClientRequestToken: chatSessionId,
                EngineConfiguration: {
                    MaxConcurrentDpus: 20
                }
            });
            
            console.log(`Starting Athena session in workgroup: ${ATHENA_WORKGROUP}`);
            const sessionResponse = await athenaClient.send(startSessionCommand);
            
            if (!sessionResponse.SessionId) {
                await publishProgress(chatSessionId, "❌ Failed to create Athena session", progressIndex++);
                return JSON.stringify({
                    error: "Failed to create Athena session",
                    details: "No session ID was returned"
                });
            }
            
            const sessionId = sessionResponse.SessionId;
            console.log(`Session ID: ${sessionId}`);
            await publishProgress(chatSessionId, `✅ Athena session created with ID: ${sessionId}`, progressIndex++);
            
            // Wait for the session to be IDLE
            await publishProgress(chatSessionId, "⏳ Waiting for session to be ready...", progressIndex++);
            let sessionState = 'CREATING';
            let sessionAttempts = 0;
            let lastReportedPercentage = 0;
            const maxSessionAttempts = Math.ceil(timeout / 5); // Poll roughly every 5 seconds
            
            while (sessionState !== 'IDLE' && sessionState !== 'FAILED' && sessionState !== 'TERMINATED' && sessionAttempts < maxSessionAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const getSessionStatusCommand = new GetSessionStatusCommand({
                    SessionId: sessionId
                });
                
                try {
                    const getSessionStatusResponse = await athenaClient.send(getSessionStatusCommand);
                    sessionState = getSessionStatusResponse.Status?.State || 'UNKNOWN';
                    console.log(`Current session state: ${sessionState} (Attempt ${sessionAttempts + 1}/${maxSessionAttempts})`);
                    
                    // Calculate percentage for progress updates
                    const percentage = Math.round((sessionAttempts / maxSessionAttempts) * 100);
                    
                    // Only update if the percentage changed significantly (e.g., by 10%)
                    if (percentage - lastReportedPercentage >= 10) {
                        await publishProgress(
                            chatSessionId, 
                            `⏳ Initializing session: ${sessionState} (${percentage}% complete)`, 
                            progressIndex
                        );
                        lastReportedPercentage = percentage;
                    }
                } catch (error) {
                    console.error('Error getting session status:', error);
                }
                
                sessionAttempts++;
            }
            
            if (sessionState !== 'IDLE') {
                await publishProgress(chatSessionId, `❌ Session failed to reach ready state: ${sessionState}`, progressIndex++);
                return JSON.stringify({
                    error: "Session did not reach IDLE state",
                    state: sessionState
                });
            }
            
            await publishProgress(chatSessionId, "✅ Session ready! Submitting PySpark code for execution...", progressIndex++);
            
            // Start the calculation execution
            const clientRequestToken = uuidv4();
            const startCommand = new StartCalculationExecutionCommand({
                SessionId: sessionId,
                CodeBlock: code,
                Description: description,
                ClientRequestToken: clientRequestToken,
            });
            
            console.log('Starting PySpark calculation execution...');
            const startResponse = await athenaClient.send(startCommand);
            
            if (!startResponse.CalculationExecutionId) {
                await publishProgress(chatSessionId, "❌ Failed to start calculation execution", progressIndex++);
                return JSON.stringify({
                    error: "Failed to start calculation execution",
                    details: "No calculation execution ID was returned"
                });
            }
            
            const calculationId = startResponse.CalculationExecutionId;
            console.log(`Calculation execution ID: ${calculationId}`);
            await publishProgress(chatSessionId, `✅ Calculation started with ID: ${calculationId}`, progressIndex++);
            
            // Poll for completion
            await publishProgress(chatSessionId, "⏳ Executing PySpark code...", progressIndex++);
            let finalState = 'CREATING';
            let resultData = null;
            let attempts = 0;
            let lastReportedExecutionPercentage = 0;
            const maxAttempts = Math.ceil(timeout / 5); // Poll roughly every 5 seconds
            
            while (
                finalState !== 'COMPLETED' &&
                finalState !== 'FAILED' &&
                finalState !== 'CANCELED' &&
                attempts < maxAttempts
            ) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const getCommand = new GetCalculationExecutionCommand({
                    CalculationExecutionId: calculationId
                });
                
                try {
                    const getResponse = await athenaClient.send(getCommand);
                    finalState = getResponse.Status?.State || 'UNKNOWN';
                    
                    if (getResponse.Status?.StateChangeReason) {
                        console.log(`State change reason: ${getResponse.Status.StateChangeReason}`);
                        await publishProgress(
                            chatSessionId, 
                            `ℹ️ Execution update: ${getResponse.Status.StateChangeReason}`, 
                            progressIndex++
                        );
                    }
                    
                    if (getResponse.Status?.State && ['COMPLETED', 'FAILED', 'CANCELED'].includes(getResponse.Status.State) && getResponse.Result) {
                        resultData = getResponse.Result;
                    }
                    
                    // Calculate percentage for progress updates
                    const execPercentage = Math.round((attempts / maxAttempts) * 100);
                    
                    // Only update if the percentage changed significantly (e.g., by 10%)
                    if (execPercentage - lastReportedExecutionPercentage >= 10) {
                        await publishProgress(
                            chatSessionId, 
                            `⏳ Executing code: ${finalState} (${execPercentage}% of max execution time)`, 
                            progressIndex
                        );
                        lastReportedExecutionPercentage = execPercentage;
                    }
                } catch (error) {
                    console.error('Error getting calculation status:', error);
                }
                
                console.log(`Current execution state: ${finalState} (Attempt ${attempts + 1}/${maxAttempts})`);
                attempts++;
            }
            
            // Check final state
            console.log(`Final state: ${finalState}`);
            
            if (finalState === 'COMPLETED') {
                await publishProgress(chatSessionId, "✅ Execution completed! Fetching results...", progressIndex++);
                
                // Get stdout content
                if (!resultData?.StdOutS3Uri) {
                    await publishProgress(chatSessionId, "⚠️ Execution completed but no output location found", progressIndex++);
                    return JSON.stringify({
                        status: "COMPLETED",
                        message: "Execution completed but no output location found"
                    });
                }
                
                // Use the helper function to fetch outputs
                const outputs = await fetchCalculationOutputs(resultData, chatSessionId, progressIndex);
                progressIndex += 3; // Account for progress updates in the helper function
                
                await publishProgress(chatSessionId, "✅ All results fetched successfully!", progressIndex++);
                await publishProgress(chatSessionId, "🎉 PySpark execution completed successfully!", progressIndex++);
                
                return JSON.stringify({
                    status: "COMPLETED",
                    output: {
                        ...outputs,
                        message: "PySpark execution completed successfully."
                    }
                });
            } else {
                await publishProgress(chatSessionId, `❌ Execution failed with state: ${finalState}`, progressIndex++);
                
                // Use the helper function to fetch outputs even in failure case
                const outputs = await fetchCalculationOutputs(resultData, chatSessionId, progressIndex);
                
                return JSON.stringify({
                    status: finalState,
                    error: "PySpark execution did not complete successfully",
                    details: "Check logs for more information",
                    output: outputs
                });
            }
        } catch (error: any) {
            await publishProgress(chatSessionId, `❌ Error: ${error.message}`, progressIndex++);
            return JSON.stringify({
                error: `Error executing PySpark code: ${error.message}`,
                suggestion: "Check your code syntax and try again"
            });
        }
    },
    {
        name: "pysparkTool",
        description: `
Use this tool to execute PySpark code using AWS Athena. The tool will create an Athena session,
execute the provided PySpark code, and return the execution results.

Important notes:
- The 'spark' session is already initialized in the execution environment
- You don't need to import SparkSession or create a new session
- The code has access to common Python and PySpark libraries
- The execution results will be returned directly in the response
- S3 URLs for the full output are also provided if needed
- Real-time progress updates are sent to the user during execution

Example usage:
- Perform data analysis using PySpark
- Create and manipulate Spark DataFrames
- Run data transformations and aggregations
- Generate visualizations from data

Simple example:
\`\`\`python
# Create a sample DataFrame
data = [("Alice", 34), ("Bob", 45), ("Charlie", 29)]
df = spark.createDataFrame(data, ["Name", "Age"])

# Show the DataFrame
print("Sample DataFrame:")
df.show()

# Perform some analysis
print("Statistics:")
df.describe().show()
\`\`\`
`,
        schema: pysparkToolSchema,
    }
);
