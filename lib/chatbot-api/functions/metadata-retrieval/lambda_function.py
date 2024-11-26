import json
import boto3
import os

s3 = boto3.client('s3')
BUCKET = os.environ['BUCKET']


def filter_metadata(metadata, category=None, complexity=None):
    if not category and not complexity:
        return metadata

    filtered = {}
    for doc_id, doc_meta in metadata.items():
        matches = True

        if category and doc_meta['tags']['category'] != category:
            matches = False
        if complexity and doc_meta['tags']['complexity'] != complexity:
            matches = False

        if matches:
            filtered[doc_id] = doc_meta

    return filtered


def lambda_handler(event, context):
    try:
        # Get metadata file
        response = s3.get_object(Bucket=BUCKET, Key='metadata.txt')
        metadata = json.loads(response['Body'].read().decode('utf-8'))

        # Parse filters from event
        body = json.loads(event.get('body', '{}'))
        category = body.get('category')
        complexity = body.get('complexity')

        # Apply filters
        filtered_metadata = filter_metadata(metadata, category, complexity)

        return {
            'statusCode': 200,
            'body': json.dumps({
                'metadata': filtered_metadata
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }