import docx
import re
import os

def extract_and_sort_attachment_sentences(file_path):
    doc = docx.Document(file_path)
    extracted_sentences = []
    seen_numbers = set()
    
    # Pattern to locate an optional "See " followed by "Attachment <number> - "
    pattern = re.compile(r'(?:See\s+)?(Attachment\s+(\d+)\s*-\s*)', re.IGNORECASE)
    # Pattern to remove the "Attachment <number> - " prefix from the extracted text.
    prefix_pattern = re.compile(r'^Attachment\s+\d+\s*-\s*', re.IGNORECASE)
    
    for para in doc.paragraphs:
        text = para.text
        matches = list(pattern.finditer(text))
        for i, match in enumerate(matches):
            attachment_number = int(match.group(2))
            if attachment_number in seen_numbers:
                continue
            start_index = match.start(1)
            end_index = matches[i + 1].start(1) if i + 1 < len(matches) else len(text)
            extracted_text = text[start_index:end_index].strip()
            # Remove the "Attachment <number> - " prefix.
            cleaned_text = prefix_pattern.sub('', extracted_text).strip()
            
            # Remove anything after the first occurrence of a right parenthesis (including the parenthesis)
            if ')' in cleaned_text:
                cleaned_text = cleaned_text.split(')')[0].strip()
            
            # Ensure the cleaned text ends with a dot.
            if cleaned_text and not cleaned_text.endswith('.'):
                cleaned_text += '.'
            
            if cleaned_text:
                extracted_sentences.append((attachment_number, cleaned_text))
                seen_numbers.add(attachment_number)
    
    sorted_sentences = sorted(extracted_sentences, key=lambda x: x[0])
    return [sentence for _, sentence in sorted_sentences]

# User input handling
file_path = input("Enter the full path to the Word document: ").strip().strip("'\"")

if not os.path.exists(file_path):
    print(f"Error: File not found at {file_path}")
else:
    try:
        results = extract_and_sort_attachment_sentences(file_path)
        if not results:
            print("No attachment references found in the document.")
        else:
            print("\nCleaned and sorted attachment references:")
            for sentence in results:
                print(sentence)
    except Exception as e:
        print(f"An error occurred: {str(e)}")