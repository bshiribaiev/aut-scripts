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

echo "Folders exist. Searching for numbered files, attachment files, and EN files..."

found_any=false

# Find files that match any of the patterns
find "$originalFolder" -type f \( -iname "*attachment*" -o -name "[0-9]*" -o -iname "EN [0-9]*" \) | while read -r file; do
  found_any=true
  echo "Found file: $file"
  filename=$(basename "$file")
  lowercase_filename=$(echo "$filename" | tr '[:upper:]' '[:lower:]')
  folderName=""

  # Check for attachment pattern first
  if [[ $lowercase_filename =~ attachment[[:space:]_]*([0-9]+) ]]; then
    folderName="${BASH_REMATCH[1]}"
    echo "Found attachment pattern with number: $folderName"
  # Check for files starting with numbers
  elif [[ $filename =~ ^([0-9]+) ]]; then
    folderName="${BASH_REMATCH[1]}"
    echo "Found numbered file pattern with number: $folderName"
  # Check for EN followed by number pattern
  elif [[ $filename =~ ^EN[[:space:]]+([0-9]+) ]]; then
    folderName="${BASH_REMATCH[1]}"
    echo "Found EN pattern with number: $folderName"
  fi

  if [ -n "$folderName" ]; then
    targetFolder="$destinationFolder/$folderName"
    mkdir -p "$targetFolder"
    cp "$file" "$targetFolder/"
    echo "Copied '$filename' → $targetFolder"
  else
    echo "No number found in filename '$filename'"
  fi
done

# Check if we found any files (note: this check won't work perfectly due to subshell)
# Using find again to verify
file_count=$(find "$originalFolder" -type f \( -iname "*attachment*" -o -name "[0-9]*" -o -iname "EN [0-9]*" \) | wc -l)
if [ "$file_count" -eq 0 ]; then
  echo "No matching files found in: $originalFolder"
else
  echo "Processing completed. Found $file_count matching files."
fi