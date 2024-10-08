// Import necessary modules
import { S3Client, ListObjectsV2Command, GetObjectTaggingCommand } from '@aws-sdk/client-s3';

export const handler = async (event) => {
  const s3Client = new S3Client();    
  try {
    const claims = event.requestContext.authorizer.jwt.claims
    const roles = JSON.parse(claims['custom:role'])
    console.log(roles)
    if (roles.some(role => role.includes("Admin"))) {
      console.log("authorized")
    } else {
      console.log("not an admin")
      return {
        statusCode: 403,
         headers: {
              'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({message: 'User is not authorized to perform this action'}),
      };
    }
  } catch (e) {
    console.log("could not check admin access")
    return {
      statusCode: 500,
       headers: {
            'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({message: 'Unable to check user role, please ensure you have Cognito configured correctly with a custom:role attribute.'}),
    };
  }
  const {continuationToken, pageIndex } = event;
  const s3Bucket = process.env.BUCKET;
  
  try {
    const command = new ListObjectsV2Command({
      Bucket: s3Bucket,
      
      ContinuationToken: continuationToken,
    });

    const result = await s3Client.send(command);
    const documents = result.Contents || [];


    // Get the admin role from claims and filter documents based on tags
    let tagFilter = null;
    const roles = JSON.parse(event.requestContext.authorizer.jwt.claims['custom:role']);
    if (roles.some(role => role.includes("Legal"))) {
      tagFilter = "Legal";
    } else if (roles.some(role => role.includes("Sourcing"))) {
      tagFilter = "Sourcing";
    }

    const filteredDocuments = [];

    for (const document of documents) {
      const taggingCommand = new GetObjectTaggingCommand({
        Bucket: s3Bucket,
        Key: document.Key
      });

      const taggingResult = await s3Client.send(taggingCommand);
      const documentTag = taggingResult.TagSet.find(tag => tag.Key === 'Category')?.Value;

      // If there's no tagFilter (MasterAdmin), include all documents
      if (!tagFilter || documentTag === tagFilter) {
        filteredDocuments.push(document);
      }
    }


    return {
      statusCode: 200,
      headers: {
            'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(filteredDocuments),
    };
  } catch (error) {
    return {
      statusCode: 500,
       headers: {
            'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({message: 'Get S3 Bucket data failed- Internal Server Error'}),
    };
  }
};
