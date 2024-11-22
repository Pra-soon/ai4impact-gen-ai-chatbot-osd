
# # Define tag values and their descriptions for categorizing documents (when values are agency specific)
CATEGORIES = {
    'user guide': 'A detailed document for a specific contract, providing clear, step-by-step instructions on how to procure goods or services. It outlines the key terms, processes, and requirements buyers need to follow.',
    'handbook': 'A comprehensive reference document that covers various aspects of OSD Procurement',
    'swc index': 'A sheet containing a list telling what contracts are available and who manages them.',
    'external reference': 'Supplementary documents or sheet that contain links for accessing other documents.',
    'memos': 'Documents which are official communications that outline updates, amendments, or directives regarding the Handbook, regulations, or other procurement policies. These documents ensure compliance with the latest changes.',
    'unknown': 'Documents that do not clearly fit into any of the above categories.'
}

# Define custom tags to provide additional metadata for documents.
CUSTOM_TAGS = {
    'complexity': ['low', 'medium', 'high'],# Levels indicating document complexity for new buyers.
    'author':[] , # Placeholder for author names; values will be extracted from content if available.,
    'creation_date':[]
}

# Descriptions for each tag to guide their use and selection.
TAG_DESCRIPTIONS = {
    'category': 'The type of document. Avoid adding inferred text like "(inferred from content)".',
    'complexity': 'Indicates how complex the document is to understand for a new buyer.',
    'author': 'The name of the person or organization who wrote or published the document. Avoid adding inferred text like "(inferred from content)".',
    'creation_date': 'The date when the document was created. Follow the format "YYYY-MM-DD". If not available, it should remain blank. Avoid addition of inferred text.',
}

# Function to compile all tags (predefined and custom) into a dictionary for easy access.
def get_all_tags():
    return {**{'category': list(CATEGORIES.keys())}, **CUSTOM_TAGS}

# Function to generate a prompt that directs the AI to analyze a document, summarize it, and apply relevant tags.
def get_full_prompt(key,content):
    all_tags = get_all_tags()

    prompt = f"""Analyze the following document and provide:
1. A summary of about 100 words.
2. Appropriate tags from the following options:

"""

    for tag, values in all_tags.items():
        prompt += f"{tag}: {', '.join(values)}\n"
        if tag in TAG_DESCRIPTIONS:
            prompt += f"   Description: {TAG_DESCRIPTIONS[tag]}\n"

    prompt += f"""
For 'creation_date', ensure the format is always 'YYYY-MM-DD'.
Do not add inferred text like "(inferred from content)".
If the creation date is missing, use the current date in 'YYYY-MM-DD' format.
Ensure that your response is in JSON format with keys 'summary' and 'tags', where 'tags' is an object containing the selected tags.
Example JSON Response:
{{
    "summary": "<Your Summary>",
    "tags": {{
        "category": "user guide",
        "author": "Operational Services Division",
        "complexity": "medium",
        "creation_date": "2023-11-20"
    }}
}}

Document Name: {key}
Document: {content}"""

    return prompt