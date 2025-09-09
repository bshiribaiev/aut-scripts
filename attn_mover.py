import os
import shutil
import re
from pathlib import Path

def main():
    print("=" * 50)
    print("           ATTACHMENT ORGANIZER")
    print("=" * 50)
    print()
    
    # Get folder paths from user
    original_folder = input("Enter the full path to the folder containing attachments: ").strip().strip('"\'')
    destination_folder = input("Enter the full path to the destination folder: ").strip().strip('"\'')
    
    print(f"\nOriginal folder: {original_folder}")
    print(f"Destination folder: {destination_folder}")
    
    # Check if folders exist
    if not os.path.exists(original_folder):
        print(f"❌ ERROR: The original folder does not exist → {original_folder}")
        input("Press Enter to exit...")
        return
    
    if not os.path.exists(destination_folder):
        print(f"❌ ERROR: The destination folder does not exist → {destination_folder}")
        input("Press Enter to exit...")
        return
    
    print("\n✅ Folders exist. Searching for attachment files...")
    
    found_any = False
    
    # Search for files with "attachment" in the name
    for root, dirs, files in os.walk(original_folder):
        for file in files:
            if "attachment" in file.lower():
                found_any = True
                file_path = os.path.join(root, file)
                print(f"\nFound file: {file}")
                
                # Extract number from filename
                match = re.search(r'attachment[\s_]*([0-9]+)', file.lower())
                if match:
                    folder_name = match.group(1)
                    target_folder = os.path.join(destination_folder, folder_name)
                    
                    # Create folder if it doesn't exist
                    os.makedirs(target_folder, exist_ok=True)
                    
                    # Copy file
                    shutil.copy2(file_path, target_folder)
                    print(f"✅ Copied '{file}' → folder {folder_name}")
                else:
                    print(f"⚠️ No number found in filename '{file}'")
    
    if not found_any:
        print(f"\n❌ No matching files found in: {original_folder}")
    
    print("\nDone! Press Enter to exit...")
    input()

if __name__ == "__main__":
    main()