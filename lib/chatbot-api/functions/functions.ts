import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

// Import Lambda L2 construct
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import { S3EventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

interface LambdaFunctionStackProps {  
  readonly wsApiEndpoint : string;  
  readonly sessionTable : Table;  
  readonly feedbackTable : Table;
  readonly feedbackBucket : s3.Bucket;
  readonly knowledgeBucket : s3.Bucket;
  readonly knowledgeBase : bedrock.CfnKnowledgeBase;
  readonly knowledgeBaseSource: bedrock.CfnDataSource;
}



export class LambdaFunctionStack extends cdk.Stack {  
  public readonly chatFunction : lambda.Function;
  public readonly sessionFunction : lambda.Function;
  public readonly feedbackFunction : lambda.Function;
  public readonly deleteS3Function : lambda.Function;
  public readonly getS3Function : lambda.Function;
  public readonly uploadS3Function : lambda.Function;
  public readonly syncKBFunction : lambda.Function;
  public readonly metadataHandlerFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaFunctionStackProps) {
    super(scope, id);    

    const sessionAPIHandlerFunction = new lambda.Function(scope, 'SessionHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'session-handler')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "DDB_TABLE_NAME" : props.sessionTable.tableName,
        "METADATA_BUCKET": props.knowledgeBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30)
    });
    
    sessionAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.sessionTable.tableArn, props.sessionTable.tableArn + "/index/*", `${props.knowledgeBucket.bucketArn}/metadata.txt`]
    }));

    this.sessionFunction = sessionAPIHandlerFunction;

        // Define the Lambda function resource
        const websocketAPIFunction = new lambda.Function(scope, 'ChatHandlerFunction', {
          runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
          code: lambda.Code.fromAsset(path.join(__dirname, 'websocket-chat')), // Points to the lambda directory
          handler: 'index.handler', // Points to the 'hello' file in the lambda directory
          environment : {
            "WEBSOCKET_API_ENDPOINT" : props.wsApiEndpoint.replace("wss","https"),            
            "PROMPT" : `
You are a procurement assistant for Massachusetts’ Operational Services Division (OSD), specializing in guiding buyers and executive offices through state purchasing processes according to 801 CMR regulations, the Procurement Handbook, SWC Index, and contract user guides.

### Instructions for Responses:

1. **Clarify User’s Needs First** (for general questions like "How do I buy stuff?"):
   - Prompt the user for specifics to guide them accurately.
   - Suggested questions:
     - "What specific item or service do you need to purchase?"
     - "Which department is this for, and what quantity is required?"
     - "Do you have a preferred vendor, or are there unique requirements?"

2. **Locate Relevant Resources Efficiently:**
   - Use key terms or summaries to quickly reference sections from the SWC Index, Procurement Handbook, 801 CMR, or contract user guides.
   - **Order of Priority**:
     - **Item or service coverage**: Check SWC Index for contract coverage.
     - **Process Guidance**: Look to the Procurement Handbook and 801 CMR for purchasing steps or regulatory compliance.

3. **Provide Clear, Sequential Guidance:**
   - Once user needs are specified, give step-by-step directions using the relevant resources.
   - When responding, focus strictly on the details relevant to the user’s query and present in user friendly manner.
   - Example flow:
     - For purchasing uniforms, state how to check the SWC, use COMMBUYS, obtain necessary quotes, and create a purchase order.
   - Use simplified language and avoid jargon unless it is buyer-specific.

4. **Accuracy and Professional Tone**:
   - Base answers only on the specified documents and, if additional detail is needed, suggest referring to these documents directly or reaching out to an OSD contact.
   - Maintain a formal, helpful tone with clear and concise language.
   - **Hallucination prevention**: If uncertain, refer the user to the appropriate document or OSD contact rather than assuming information.

5. **Hyperlinking Option**:
   - Where possible, include hyperlinks to the relevant online resources (e.g., SWC Index, COMMBUYS) to improve user accessibility and efficiency. Only provide links if they can be directly accessed by the user.

### Example Interaction:

- **User**: "How do I buy uniforms?"
- **Response**:
   - "Could you specify the department and quantity of uniforms you need?"
   - *If the user confirms*:
      - "To proceed with a uniform purchase:
         1. Refer to Statewide Contract CLT08, accessible via COMMBUYS, as it covers uniforms.
         2. Review the CLT08 User Guide for specific ordering instructions.
         3. For questions on contract terms, reach out to Michael Barry at 617-720-3182 or Michael.Barry3@mass.gov.
         4. Use OSD’s guidelines to gather necessary quotes and create your purchase order.”

`,
            'KB_ID' : props.knowledgeBase.attrKnowledgeBaseId
          },
          timeout: cdk.Duration.seconds(300)
        });
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:InvokeModel',
            
          ],
          resources: ["*"]
        }));
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:Retrieve'
          ],
          resources: [props.knowledgeBase.attrKnowledgeBaseArn]
        }));

        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:InvokeFunction'
          ],
          resources: [this.sessionFunction.functionArn]
        }));

        this.chatFunction = websocketAPIFunction;

    const feedbackAPIHandlerFunction = new lambda.Function(scope, 'FeedbackHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'feedback-handler')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "FEEDBACK_TABLE" : props.feedbackTable.tableName,
        "FEEDBACK_S3_DOWNLOAD" : props.feedbackBucket.bucketName
      },
      timeout: cdk.Duration.seconds(30)
    });
    
    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.feedbackTable.tableArn, props.feedbackTable.tableArn + "/index/*"]
    }));

    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.feedbackBucket.bucketArn,props.feedbackBucket.bucketArn+"/*"]
    }));

    this.feedbackFunction = feedbackAPIHandlerFunction;
    
    const deleteS3APIHandlerFunction = new lambda.Function(scope, 'DeleteS3FilesHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/delete-s3')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    deleteS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.deleteS3Function = deleteS3APIHandlerFunction;

    const getS3APIHandlerFunction = new lambda.Function(scope, 'GetS3FilesHandlerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/get-s3')), // Points to the lambda directory
      handler: 'index.handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    getS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.getS3Function = getS3APIHandlerFunction;


    const kbSyncAPIHandlerFunction = new lambda.Function(scope, 'SyncKBHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/kb-sync')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "KB_ID" : props.knowledgeBase.attrKnowledgeBaseId,      
        "SOURCE" : props.knowledgeBaseSource.attrDataSourceId  
      },
      timeout: cdk.Duration.seconds(30)
    });

    kbSyncAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:*'
      ],
      resources: [props.knowledgeBase.attrKnowledgeBaseArn]
    }));
    this.syncKBFunction = kbSyncAPIHandlerFunction;

    const uploadS3APIHandlerFunction = new lambda.Function(scope, 'UploadS3FilesHandlerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/upload-s3')), // Points to the lambda directory
      handler: 'index.handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    uploadS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.uploadS3Function = uploadS3APIHandlerFunction;





    // Define the Lambda function for metadata
    const metadataHandlerFunction = new lambda.Function(scope, 'MetadataHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(path.join(__dirname, 'metadata-handler')),
      handler: 'lambda_function.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        "BUCKET": props.knowledgeBucket.bucketName,
        "KB_ID": props.knowledgeBase.attrKnowledgeBaseId
      },
    });



    metadataHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*' ,// Grants full access to all S3 actions (read, write, delete, etc.)
        'bedrock:InvokeModel',
        'bedrock:Retrieve',
      ],
      resources: [
        props.knowledgeBucket.bucketArn,               // Grants access to the bucket itself (for actions like ListBucket)
        props.knowledgeBucket.bucketArn + "/*" ,        // Grants access to all objects within the bucket
        'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0',  // Add the Bedrock model resource explicitly
        props.knowledgeBase.attrKnowledgeBaseArn,

      ]
    }));


// Trigger the lambda function when a document is uploaded

    this.metadataHandlerFunction = metadataHandlerFunction;

      metadataHandlerFunction.addEventSource(new S3EventSource(props.knowledgeBucket, {
        events: [s3.EventType.OBJECT_CREATED],
      }));

    websocketAPIFunction.addEnvironment("METADATA_HANDLER_FUNCTION", metadataHandlerFunction.functionArn);

  }
}
