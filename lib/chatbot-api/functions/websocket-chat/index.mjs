import { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockAgentRuntimeClient, RetrieveCommand as KBRetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import ClaudeModel from "./models/claude3Sonnet.mjs";
import Mistral7BModel from "./models/mistral7b.mjs"
import { PROMPT } from './prompt.mjs';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";



/*global fetch*/

const ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;
const wsConnectionClient = new ApiGatewayManagementApiClient({ endpoint: ENDPOINT });


const fetchMetadata = async (filters) => {
  const lambdaClient = new LambdaClient({});
  const payload = JSON.stringify({ filters });
  try {
    const command = new InvokeCommand({
      FunctionName: process.env.METADATA_RETRIEVAL_FUNCTION,
      Payload: Buffer.from(payload),
    });
    const response = await lambdaClient.send(command);
    const parsedPayload = JSON.parse(Buffer.from(response.Payload).toString());
    const metadata = JSON.parse(parsedPayload.body).metadata;
    return metadata;
  } catch (error) {
    console.error("Error fetching metadata:", error);
    return null;
  }
};
// // Function to create dynamic prompt with metadata information
// const constructSysPrompt = async() => {
//     const metadata = await fetchMetadata();
//
//     if(metadata){
//         console.log("Metadata added successfully to prompt");
//         return `${PROMPT}\n\n###Metadata information:\n${JSON.stringify(metadata,null,2)}`;
//     } else
//     {
//         console.warn("Metadata information couldn't be added to prompt");
//         return PROMPT;
//     }
// }

// const SYS_PROMPT = await constructSysPrompt();
const SYS_PROMPT = PROMPT;

console.log(SYS_PROMPT);

const s3Client = new S3Client({ region: "us-east-1" });
/* Use the Bedrock Knowledge Base*/
async function retrieveKBDocs(query, knowledgeBase, knowledgeBaseID) {
  const input = { // RetrieveRequest
  knowledgeBaseId: knowledgeBaseID, // required
  retrievalQuery: { // KnowledgeBaseQuery
    text: query, // required
  }}


  try {
    const command = new KBRetrieveCommand(input);
    const response = await knowledgeBase.send(command);

    // filter the items based on confidence, we do not want LOW confidence results
    const confidenceFilteredResults = response.retrievalResults.filter(item =>
      item.score > 0.5
    )
    // console.log(confidenceFilteredResults)
    let fullContent = confidenceFilteredResults.map(item => item.content.text).join('\n');

   const documentUris = await Promise.all(
  confidenceFilteredResults.map(async (item) => {
    const s3Uri = item.location.s3Location.uri; // Original S3 URI
    const bucketName = s3Uri.split("/")[2]; // Extract bucket name
    const objectKey = s3Uri.split("/").slice(3).join("/"); // Extract object key

    // Generate a pre-signed URL
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }),
      { expiresIn: 3600 } // URL expiration time in seconds
    );

    return {
      title: objectKey + " (Bedrock Knowledge Base)",
      uri: signedUrl, // Use the pre-signed URL
    };
  })
);

    // removes duplicate sources based on URI
    const flags = new Set();
    const uniqueUris = documentUris.filter(entry => {
      if (flags.has(entry.uri)) {
        return false;
      }
      flags.add(entry.uri);
      return true;
    });

    // console.log(fullContent);

    //Returning both full content and list of document URIs
    if (fullContent == '') {
      fullContent = `No knowledge available! This query is likely outside the scope of your knowledge.
      Please provide a general answer but do not attempt to provide specific details.`
      console.log("Warning: no relevant sources found")
    }

    return {
      content: fullContent,
      uris: uniqueUris
    };
  } catch (error) {
    console.error("Caught error: could not retrieve Knowledge Base documents:", error);
    // return no context
    return {
      content: `No knowledge available! There is something wrong with the search tool. Please tell the user to submit feedback.
      Please provide a general answer but do not attempt to provide specific details.`,
      uris: []
    };
  }
}

const getUserResponse = async (id, requestJSON) => {
  try {
    const data = requestJSON.data;    

    let userMessage = data.userMessage;
    const userId = data.user_id;
    const sessionId = data.session_id;
    const chatHistory = data.chatHistory;    
    
    const knowledgeBase = new BedrockAgentRuntimeClient({ region: 'us-east-1' });

    if (!process.env.KB_ID) {
      throw new Error("Knowledge Base ID is not found.");
    }        

    // retrieve a model response based on the last 5 messages
    // messages come paired, so that's why the slice is only 2 (2 x 2 + the latest prompt = 5)
    let claude = new ClaudeModel();
    let lastFiveMessages = chatHistory.slice(-2);
    
    let stopLoop = false;        
    let modelResponse = ''
    
    let history = [];
    try {
        history = claude.assembleHistory(lastFiveMessages, "Please use your search tool one or more times based on this latest prompt: ".concat(userMessage));
        
        // Validate history structure
        for (let i = 0; i < history.length; i++) {
            if (history[i].content?.[0]?.type === 'tool_result') {
                if (i === 0 || history[i-1].content?.[0]?.type !== 'tool_use') {
                    // Remove invalid tool_result entry
                    history.splice(i, 1);
                    i--; // Adjust index after removal
                }
            }
        }
    } catch (error) {
        console.error("Error assembling chat history:", error);
        throw new Error("Failed to assemble valid chat history");
    }
    
    let fullDocs = {"content" : "", "uris" : []}
    
    while (!stopLoop) {
      console.log("started new stream")
      // console.log(lastFiveMessages)
      // console.log(history)
      history.forEach((historyItem) => {
        console.log(historyItem)
      })
      const stream = await claude.getStreamedResponse(SYS_PROMPT, history);
      try {
        // store the full model response for saving to sessions later
        
        let toolInput = "";
        let assemblingInput = false
        let usingTool = false;
        let toolId;
        let skipChunk = true;
        // this is for when the assistant uses a tool
        let message = {};
        // this goes in that message
        let toolUse = {}
        
        // iterate through each chunk from the model stream
        for await (const event of stream) {
          const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          const parsedChunk = await claude.parseChunk(chunk);
          if (parsedChunk) {                      
            
            // this means that we got tool use input or stopped generating text
            if (parsedChunk.stop_reason) {
              if (parsedChunk.stop_reason == "tool_use") {
                assemblingInput = false;
                usingTool = true;
                skipChunk = true;
              } else {
                stopLoop = true;
                break;
              }
            }
            
            // this means that we are collecting tool use input
            if (parsedChunk.type) {
              if (parsedChunk.type == "tool_use") {
                assemblingInput = true;
                toolId = parsedChunk.id;
                
                // First add the tool use message
                const toolUseMessage = {
                  role: "assistant",
                  content: [
                    {
                      type: "tool_use",
                      id: toolId,
                      name: parsedChunk.name,
                      input: parsedChunk.input || {'query': ""}
                    }
                  ]
                };
                history.push(toolUseMessage);

                // Handle metadata fetch if needed
                if (parsedChunk.name === "fetch_metadata") {
                  try {
                    const filters = {
                      category: parsedChunk.input.category
                    };
                    const metadata = await fetchMetadata(filters);
                    
                    // Add tool result only after tool use message
                    const toolResponse = {
                      role: "user",
                      content: [
                        {
                          type: "tool_result",
                          tool_use_id: toolId,
                          content: JSON.stringify(metadata, null, 2)
                        }
                      ]
                    };
                    history.push(toolResponse);
                    
                    usingTool = false;
                    toolInput = "";
                    console.log("correctly used metadata tool!");
                  } catch (error) {
                    console.error("Error handling metadata fetch:", error);
                  }
                }
              }
            }

            if (usingTool) {
                // Verify there's a corresponding tool_use message before adding the response
                const hasToolUse = history.some(msg => 
                    msg.role === 'assistant' && 
                    msg.content?.[0]?.type === 'tool_use' &&
                    msg.content[0].id === toolId
                );

                // Check for duplicate tool results
                const hasDuplicateResult = history.some(msg =>
                    msg.role === 'user' &&
                    msg.content?.[0]?.type === 'tool_result' &&
                    msg.content[0].tool_use_id === toolId
                );

                if (hasToolUse && !hasDuplicateResult) {
                    let toolResponse = {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": toolId,
                                "content": toolInput
                            }
                        ]
                    };
                    
                    history.push(toolResponse);
                    console.log("correctly used tool!");
                } else {
                    console.warn(hasDuplicateResult ? 
                        "Duplicate tool result detected - skipping" : 
                        "Attempted to add tool_result without matching tool_use"
                    );
                }
                
                usingTool = false;
                toolInput = "";
            } else {             
            
              if  (assemblingInput & !skipChunk) {
                toolInput = toolInput.concat(parsedChunk);
                // toolUse.input.query += parsedChunk;
              } else if (!assemblingInput) {
                // console.log('writing out to user')
                let responseParams = {
                  ConnectionId: id,
                  Data: parsedChunk.toString()
                }
                modelResponse = modelResponse.concat(parsedChunk)
                let command = new PostToConnectionCommand(responseParams);
                        
                try {
                  await wsConnectionClient.send(command);
                } catch (error) {
                  console.error("Error sending chunk:", error);
                }
              } else if (skipChunk) {
                skipChunk = false;
              }
            }
            
            
            
          }
        }        
        
      } catch (error) {
        console.error("Stream processing error:", error);
        let responseParams = {
          ConnectionId: id,
          Data: `<!ERROR!>: ${error}`
        }
        let command = new PostToConnectionCommand(responseParams);
        await wsConnectionClient.send(command);
      }
  
    }

    let command;
    let links = JSON.stringify(fullDocs.uris)
    // send end of stream message
    try {
      let eofParams = {
        ConnectionId: id,
        Data: "!<|EOF_STREAM|>!"
      }
      command = new PostToConnectionCommand(eofParams);
      await wsConnectionClient.send(command);

      // send sources
      let responseParams = {
        ConnectionId: id,
        Data: links
      }
      command = new PostToConnectionCommand(responseParams);
      await wsConnectionClient.send(command);
    } catch (e) {
      console.error("Error sending EOF_STREAM and sources:", e);
    }


    const sessionRequest = {
      body: JSON.stringify({
        "operation": "get_session",
        "user_id": userId,
        "session_id": sessionId
      })
    }
    const client = new LambdaClient({});
    const lambdaCommand = new InvokeCommand({
      FunctionName: process.env.SESSION_HANDLER,
      Payload: JSON.stringify(sessionRequest),
    });

    const { Payload, LogResult } = await client.send(lambdaCommand);
    const result = Buffer.from(Payload).toString();

    // Check if the request was successful
    if (!result) {
      throw new Error(`Error retriving session data!`);
    }

    // Parse the JSON
    let output = {};
    try {
      const response = JSON.parse(result);
      output = JSON.parse(response.body);
      console.log('Parsed JSON:', output);
    } catch (error) {
      console.error('Failed to parse JSON:', error);
      let responseParams = {
        ConnectionId: id,
        Data: '<!ERROR!>: Unable to load past messages, please retry your query'
      }
      command = new PostToConnectionCommand(responseParams);
      await wsConnectionClient.send(command);
      return; // Optional: Stop further execution in case of JSON parsing errors
    }

    // Continue processing the data
    const retrievedHistory = output.chat_history;
    let operation = '';
    let title = ''; // Ensure 'title' is initialized if used later in your code

    // Further logic goes here

    let newChatEntry = {
        "user": userMessage,
        "chatbot": {
            "tool_use": history.find(msg => 
                msg.role === 'assistant' && 
                msg.content?.[0]?.type === 'tool_use'
            )?.content?.[0] || null,
            "tool_result": history.find(msg => 
                msg.role === 'user' && 
                msg.content?.[0]?.type === 'tool_result'
            )?.content?.[0] || null,
            "final_response": modelResponse,
            "sources": documentUris
        }
    };
    if (retrievedHistory === undefined) {
      operation = 'add_session';
      let titleModel = new Mistral7BModel();
      const CONTEXT_COMPLETION_INSTRUCTIONS =
        `<s>[INST]Generate a concise title for this chat session based on the initial user prompt and response. The title should succinctly capture the essence of the chat's main topic without adding extra content.[/INST]
      [INST]${userMessage}[/INST]
      ${modelResponse} </s>
      Here's your session title:`;
      title = await titleModel.getPromptedResponse(CONTEXT_COMPLETION_INSTRUCTIONS, 25);
      title = title.replaceAll(`"`, '');
    } else {
      operation = 'update_session';
    }

    const sessionSaveRequest = {
      body: JSON.stringify({
        "operation": operation,
        "user_id": userId,
        "session_id": sessionId,
        "new_chat_entry": newChatEntry,
        "title": title
      })
    }

    const lambdaSaveCommand = new InvokeCommand({
      FunctionName: process.env.SESSION_HANDLER,
      Payload: JSON.stringify(sessionSaveRequest),
    });

    // const { SessionSavePayload, SessionSaveLogResult } = 
    await client.send(lambdaSaveCommand);

    const input = {
      ConnectionId: id,
    };
    await wsConnectionClient.send(new DeleteConnectionCommand(input));

  } catch (error) {
    console.error("Error:", error);
    let responseParams = {
      ConnectionId: id,
      Data: `<!ERROR!>: ${error}`
    }
    let command = new PostToConnectionCommand(responseParams);
    await wsConnectionClient.send(command);
  }
}

export const handler = async (event) => {
  if (event.requestContext) {    
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;
    let body = {};
    try {
      if (event.body) {
        body = JSON.parse(event.body);
      }
    } catch (err) {
      console.error("Failed to parse JSON:", err)
    }
    console.log(routeKey);

    switch (routeKey) {
      case '$connect':
        console.log('CONNECT')
        return { statusCode: 200 };
      case '$disconnect':
        console.log('DISCONNECT')
        return { statusCode: 200 };
      case '$default':
        console.log('DEFAULT')
        return { 'action': 'Default Response Triggered' }
      case "getChatbotResponse":
        console.log('GET CHATBOT RESPONSE')
        await getUserResponse(connectionId, body)
        return { statusCode: 200 };      
      default:
        return {
          statusCode: 404,  // 'Not Found' status code
          body: JSON.stringify({
            error: "The requested route is not recognized."
          })
        };
    }
  }
  return {
    statusCode: 200,
  };
};