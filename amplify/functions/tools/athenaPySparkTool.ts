import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AthenaClient, StartCalculationExecutionCommand, GetCalculationExecutionCommand, StartSessionCommand, GetSessionStatusCommand, ListSessionsCommand } from '@aws-sdk/client-athena';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { getConfiguredAmplifyClient } from '../../../utils/amplifyUtils';
import { publishResponseStreamChunk } from "../graphql/mutations";
import { getChatSessionId, getChatSessionPrefix } from "./toolUtils";
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

// Helper function to execute a calculation and wait for completion
export async function executeCalculation(
    athenaClient: AthenaClient,
    sessionId: string, 
    code: string, 
    description: string, 
    chatSessionId: string, 
    progressIndex: number,
    options: {
        timeoutSeconds?: number,
        waitMessage?: string,
        successMessage?: string,
        failureMessage?: string,
        continueOnFailure?: boolean
    } = {}
): Promise<{ 
    success: boolean, 
    state: string, 
    calculationId?: string, 
    resultData?: any, 
    newProgressIndex: number 
}> {
    const {
        timeoutSeconds = 60,
        waitMessage = "⏳ Executing calculation...",
        successMessage = "✅ Calculation completed successfully",
        failureMessage = "❌ Calculation failed",
        continueOnFailure = false
    } = options;
    
    let currentProgressIndex = progressIndex;
    
    // Start the calculation execution
    const clientRequestToken = uuidv4();
    const startCommand = new StartCalculationExecutionCommand({
        SessionId: sessionId,
        CodeBlock: code,
        Description: description,
        ClientRequestToken: clientRequestToken,
    });
    
    console.log(`Starting calculation execution: ${description}`);
    const startResponse = await athenaClient.send(startCommand);
    
    if (!startResponse.CalculationExecutionId) {
        await publishProgress(chatSessionId, `${failureMessage}: No calculation ID returned`, currentProgressIndex++);
        return { 
            success: false, 
            state: 'FAILED', 
            newProgressIndex: currentProgressIndex 
        };
    }
    
    const calculationId = startResponse.CalculationExecutionId;
    console.log(`Calculation execution ID: ${calculationId}`);
    
    // Poll for completion
    await publishProgress(chatSessionId, waitMessage, currentProgressIndex++);
    let finalState = 'CREATING';
    let resultData = null;
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;
    
    while (
        finalState !== 'COMPLETED' &&
        finalState !== 'FAILED' &&
        finalState !== 'CANCELED' &&
        Date.now() - startTime < timeoutMs
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
            }
            
            if (getResponse.Status?.State && ['COMPLETED', 'FAILED', 'CANCELED'].includes(getResponse.Status.State) && getResponse.Result) {
                resultData = getResponse.Result;
            }
        } catch (error) {
            console.error(`Error getting calculation status: ${error}`);
        }
        
        const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
        console.log(`Calculation state: ${finalState} (${elapsedSeconds}s elapsed / ${timeoutSeconds}s timeout)`);
    }
    
    if (finalState === 'COMPLETED') {
        await publishProgress(chatSessionId, successMessage, currentProgressIndex++);
        return { 
            success: true, 
            state: finalState, 
            calculationId, 
            resultData, 
            newProgressIndex: currentProgressIndex 
        };
    } else {
        if (!continueOnFailure) {
            await publishProgress(chatSessionId, `${failureMessage}: ${finalState}`, currentProgressIndex++);
        } else {
            await publishProgress(chatSessionId, `⚠️ Warning: ${failureMessage}: ${finalState}`, currentProgressIndex++);
        }
        
        return { 
            success: false, 
            state: finalState, 
            calculationId, 
            resultData, 
            newProgressIndex: currentProgressIndex 
        };
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
        console.info('Error publishing progress update:', error);
    }
}

// Helper function to fetch calculation outputs from S3
export async function fetchCalculationOutputs(resultData: any, chatSessionId: string, progressIndex: number) {
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

// Helper function to find an existing active session for a chat session
async function findExistingSession(athenaClient: AthenaClient, chatSessionId: string): Promise<string | null> {
    try {
        console.log(`Looking for existing session for chat session: ${chatSessionId}`);
        
        const listSessionsCommand = new ListSessionsCommand({
            WorkGroup: ATHENA_WORKGROUP,
            // Only look for recent sessions that might be active
            StateFilter: 'IDLE'
        });
        
        const response = await athenaClient.send(listSessionsCommand);
        
        if (!response.Sessions || response.Sessions.length === 0) {
            console.log('No active sessions found');
            return null;
        }
        
        // Find a session that was created with this chat session ID
        // SessionSummary doesn't have ClientRequestToken, so we check Description
        // which includes the chat session ID as part of the description
        const matchingSession = response.Sessions.find(session => 
            session.Description?.includes(`[ChatSessionID:${chatSessionId}]`) &&
            session.SessionId
        );
        
        if (matchingSession && matchingSession.SessionId) {
            console.log(`Found existing session: ${matchingSession.SessionId}`);
            return matchingSession.SessionId;
        }
        
        console.log('No matching session found for this chat session ID');
        return null;
    } catch (error) {
        console.error('Error finding existing session:', error);
        return null;
    }
}

// Helper function to check if a session is active and usable
async function isSessionActive(athenaClient: AthenaClient, sessionId: string): Promise<boolean> {
    try {
        const getSessionStatusCommand = new GetSessionStatusCommand({
            SessionId: sessionId
        });
        
        const response = await athenaClient.send(getSessionStatusCommand);
        
        if (response.Status?.State === 'IDLE') {
            console.log(`Session ${sessionId} is active and idle`);
            return true;
        }
        
        console.log(`Session ${sessionId} is not in IDLE state, current state: ${response.Status?.State}`);
        return false;
    } catch (error) {
        console.error(`Error checking session status for ${sessionId}:`, error);
        return false;
    }
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
            
            // Try to find an existing active session first
            await publishProgress(chatSessionId, "🔍 Checking for existing session...", progressIndex++);
            let sessionId: string | null = null;
            
            // First look for an existing session for this chat session
            const existingSessionId = await findExistingSession(athenaClient, chatSessionId);
            
            if (existingSessionId) {
                // Check if the session is still active
                const isActive = await isSessionActive(athenaClient, existingSessionId);
                
                if (isActive) {
                    sessionId = existingSessionId;
                    await publishProgress(chatSessionId, `✅ Reusing existing Athena session (faster execution)`, progressIndex++);
                    console.log(`Reusing existing active session: ${sessionId} for chat session: ${chatSessionId}`);
                } else {
                    await publishProgress(chatSessionId, `⚠️ Found existing session but it's no longer active, creating a new one...`, progressIndex++);
                    console.log(`Found session ${existingSessionId} but it's not in IDLE state, will create new session`);
                }
            }
            
            // If no active session was found, create a new one
            if (!sessionId) {
                await publishProgress(chatSessionId, "🔄 Creating new Athena session...", progressIndex++);
                
                // Use chatSessionId as the sessionToken for reuse
                const sessionToken = chatSessionId;
                const startSessionCommand = new StartSessionCommand({
                    WorkGroup: ATHENA_WORKGROUP,
                    Description: `Session for ${description} [ChatSessionID:${chatSessionId}]`,
                    ClientRequestToken: sessionToken,
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
                
                sessionId = sessionResponse.SessionId;
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
            }
            
            await publishProgress(chatSessionId, "✅ Session ready! Setting up environment...", progressIndex++);
            
            // Add pulp library from S3
            const setS3PrefixResult = await executeCalculation(
                athenaClient,
                sessionId,
                `
chatSessionS3Prefix = '${getChatSessionPrefix()}'
# sc.addPyFile('s3://${process.env.STORAGE_BUCKET_NAME}/pypi/pypi_libs.zip')

def uploadDfToS3(df, file_path):
    import io
    import boto3
    
    # Convert dataframe to CSV in memory
    csv_buffer = io.StringIO()
    df.toPandas().to_csv(csv_buffer, header=True, index=False)
    
    # Get the CSV content as bytes
    csv_content = csv_buffer.getvalue().encode('utf-8')
    
    # Upload directly to S3 from memory
    s3_client = boto3.client('s3', region_name='us-east-1')
    s3_client.put_object(
        Body=csv_content,
        Bucket='${process.env.STORAGE_BUCKET_NAME}',
        Key=chatSessionS3Prefix + file_path
    )

                `,
                "Set S3 URI",
                chatSessionId,
                progressIndex,
                {
                    timeoutSeconds: 60, // About 1 minute max wait time
                    waitMessage: "📚 Setting S3 URI...",
                    successMessage: "✅ Successfully set S3 URI",
                    failureMessage: "Failed to set S3 URI",
                    continueOnFailure: true
                }
            );
            
            progressIndex = setS3PrefixResult.newProgressIndex;
            
            await publishProgress(chatSessionId, "✅ Submitting your PySpark code for execution...", progressIndex++);
            
            // Execute the main code
            const codeResult = await executeCalculation(
                athenaClient,
                sessionId,
                code,
                description,
                chatSessionId,
                progressIndex,
                {
                    timeoutSeconds: Math.ceil(timeout),
                    waitMessage: "⏳ Executing PySpark code...",
                    successMessage: "✅ Execution completed! Fetching results..."
                }
            );
            
            progressIndex = codeResult.newProgressIndex;
            
            // Check final state
            if (codeResult.success) {
                // Get stdout content
                if (!codeResult.resultData?.StdOutS3Uri) {
                    await publishProgress(chatSessionId, "⚠️ Execution completed but no output location found", progressIndex++);
                    return JSON.stringify({
                        status: "COMPLETED",
                        message: "Execution completed but no output location found"
                    });
                }
                
                // Use the helper function to fetch outputs
                const outputs = await fetchCalculationOutputs(codeResult.resultData, chatSessionId, progressIndex);
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
                await publishProgress(chatSessionId, `❌ Execution failed with state: ${codeResult.state}`, progressIndex++);
                
                // Use the helper function to fetch outputs even in failure case
                const outputs = await fetchCalculationOutputs(codeResult.resultData, chatSessionId, progressIndex);
                
                return JSON.stringify({
                    status: codeResult.state,
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
- uploadDfToS3 is a helper function that uploads a DataFrame to S3

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

# Save the DataFrame to S3
uploadDfToS3(df, 'output/dataframe.csv')
\`\`\`

Available libraries:
boto3==1.24.31
botocore==1.27.31
certifi==2022.6.15
charset-normalizer==2.1.0
cycler==0.11.0
cython==0.29.30
docutils==0.19
fonttools==4.34.4
idna==3.3
jmespath==1.0.1
joblib==1.1.0
kiwisolver==1.4.4
matplotlib==3.5.2
mpmath==1.2.1
numpy==1.23.1
packaging==21.3
pandas==1.4.3
patsy==0.5.2
pillow==9.2.0
plotly==5.9.0
pmdarima==1.8.5
pyathena==2.9.6
pyparsing==3.0.9
python-dateutil==2.8.2
pytz==2022.1
requests==2.28.1
s3transfer==0.6.0
scikit-learn==1.1.1
scipy==1.8.1
seaborn==0.11.2
six==1.16.0
statsmodels==0.13.2
sympy==1.10.1
tenacity==8.0.1
threadpoolctl==3.1.0
urllib3==1.26.10
pyarrow==9.0.0
`,
        schema: pysparkToolSchema,
    }
);
