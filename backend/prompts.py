# Internal prompts for Playground tools

def get_analyzer_prompt(action, text):
    prompts = {
        "Summarize": "Provide a concise summary of the following text:\n\n{text}",
        "Explain": "Explain the following text in simple, easy-to-understand terms:\n\n{text}",
        "Extract keywords": "Extract the most important keywords and phrases from the following text as a comma-separated list:\n\n{text}",
        "Detect sentiment": "Analyze the sentiment of the following text (e.g., Positive, Negative, Neutral) and provide a brief explanation:\n\n{text}",
        "Identify topics": "Identify the main topics discussed in the following text:\n\n{text}",
        "Generate questions": "Generate 3-5 thought-provoking questions based on the following text:\n\n{text}"
    }
    return prompts.get(action, "Analyze this text:\n\n{text}").format(text=text)

def get_extract_prompt(text, fields):
    return f"Extract the following fields from the text below. If a field is not present, write 'N/A'. Return the results as structured data.\n\nFields to extract:\n{fields}\n\nText:\n{text}"

def get_classifier_prompt(text, categories):
    return f"Classify the following text into exactly ONE of the following categories: {categories}.\n\nProvide the result in this format:\nCategory: [Category]\nConfidence: [High/Medium/Low]\nReason: [Brief explanation]\n\nText:\n{text}"

def get_transformer_prompt(action, text):
    prompts = {
        "Rewrite": "Rewrite the following text to improve flow and clarity:\n\n{text}",
        "Shorten": "Shorten the following text while retaining the core message:\n\n{text}",
        "Expand": "Expand on the following text by adding more detail and context:\n\n{text}",
        "Simplify": "Simplify the following text so it can be understood by a 10-year-old:\n\n{text}",
        "Professional": "Rewrite the following text in a highly professional, business-appropriate tone:\n\n{text}",
        "Casual": "Rewrite the following text in a friendly, casual, and conversational tone:\n\n{text}",
        "Creative": "Rewrite the following text in a creative, engaging, and imaginative way:\n\n{text}",
    }
    return prompts.get(action, "Transform this text:\n\n{text}").format(text=text)
