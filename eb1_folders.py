import os

# List of EB1-A criteria
eb1a_criteria = [
    "1. National_or_International_Awards",
    "2. Associations",
    "3. Published_Material_About_You",
    "4. Judge_of_Others_Work",
    "5. Original_Contributions_of_Major_Significance",
    "6. Authorship_of_Scholarly_Articles",
    "7. Artistic_Exhibitions_or_Showcases",
    "8. Leading_or_Critical_Role",
    "9. High_Salary",
    "10. Commercial_Success_in_Performing_Arts"
]

# Prompt user for target directory
target_dir = input("Enter the full path to the directory where folders should be created:\n").strip()

# Validate and create folders
if not os.path.isdir(target_dir):
    print(f"Directory does not exist: {target_dir}")
else:
    for criterion in eb1a_criteria:
        folder_path = os.path.join(target_dir, criterion.replace(" ", "_"))
        try:
            os.makedirs(folder_path)
            print(f"Created folder: {folder_path}")
        except FileExistsError:
            print(f"Folder already exists: {folder_path}")
