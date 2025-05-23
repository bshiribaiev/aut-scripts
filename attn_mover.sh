#!/bin/bash

read -p "Enter the full path to the folder containing attachments: " originalFolder
read -p "Enter the full path to the destination folder: " destinationFolder

# Strip all types of quotes
originalFolder="${originalFolder%\"}"
originalFolder="${originalFolder#\"}"
originalFolder="${originalFolder%\'}"
originalFolder="${originalFolder#\'}"

destinationFolder="${destinationFolder%\"}"
destinationFolder="${destinationFolder#\"}"
destinationFolder="${destinationFolder%\'}"
destinationFolder="${destinationFolder#\'}"

echo "Original folder resolved to: $originalFolder"
echo "Destination folder resolved to: $destinationFolder"

# Check existence
if [ ! -d "$originalFolder" ]; then
  echo "ERROR: The original folder does not exist → [$originalFolder]"
  exit 1
fi

if [ ! -d "$destinationFolder" ]; then
  echo "ERROR: The destination folder does not exist → [$destinationFolder]"
  exit 1
fi

echo "✅ Folders exist. Searching for attachment files..."

# Find files
find "$originalFolder" -type f -iname "*attachment*" | while read -r file; do
  found_any=true
  echo "Found file: $file"
  filename=$(basename "$file")
  lowercase_filename=$(echo "$filename" | tr '[:upper:]' '[:lower:]')

  if [[ $lowercase_filename =~ attachment[[:space:]_]*([0-9]+) ]]; then
    folderName="${BASH_REMATCH[1]}"
    targetFolder="$destinationFolder/$folderName"
    mkdir -p "$targetFolder"
    cp "$file" "$targetFolder/"
    echo "✅ Copied '$filename' → $targetFolder"
  else
    echo "⚠️ No number found in filename '$filename'"
  fi
done

if [ "$found_any" = false ]; then
  echo "❌ No matching files found in: $originalFolder"
fi
